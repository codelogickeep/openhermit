import fs from 'fs';
import { EventEmitter } from 'events';
import { getDingTalkAppKey, getDingTalkAppSecret, getAllowedRootDir, getDingTalkUserId } from '../config/index.js';
import logger from '../utils/logger.js';
import debounce from 'lodash.debounce';

// 动态导入 ESM 模块
let DWClient;
let TOPIC_ROBOT;
let EventAck;
try {
  const module = await import('dingtalk-stream-sdk-nodejs');
  DWClient = module.DWClient;
  TOPIC_ROBOT = module.TOPIC_ROBOT;
  EventAck = module.EventAck;
} catch (e) {
  console.warn('无法加载钉钉 SDK，将使用模拟模式');
}

/**
 * 钉钉通道网关
 */
class DingTalkChannel extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.buffer = '';
    this.debouncedSend = null;
    this.connected = false;
    this.userId = null;
    this.mockMode = false;
    this.sessionWebhook = null;
    this.hasWelcomed = false; // 是否已发送欢迎消息
    this.cachedToken = null;
    this.tokenExpireAt = 0;
    this.processedMsgIds = new Set(); // 已处理的消息 ID（去重）
    this.msgIdExpireTime = 60000; // 消息 ID 过期时间（1分钟）
    this.silentMode = true; // 静默模式（不实时发送）
    this.maxBufferSize = 10000; // 最大缓冲区大小
  }

  /**
   * 获取 access_token（带缓存，有效期 110 分钟）
   * @returns {Promise<string>}
   */
  async getAccessToken() {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpireAt) {
      return this.cachedToken;
    }

    const axios = (await import('axios')).default;
    const AppKey = getDingTalkAppKey();
    const AppSecret = getDingTalkAppSecret();

    const tokenResult = await axios.get(
      `https://oapi.dingtalk.com/gettoken?appkey=${AppKey}&appsecret=${AppSecret}`
    );

    this.cachedToken = tokenResult.data.access_token;
    // 钉钉 token 有效期 2 小时，缓存 110 分钟留 10 分钟缓冲
    this.tokenExpireAt = now + 110 * 60 * 1000;

    return this.cachedToken;
  }

  /**
   * 连接到钉钉
   */
  async connect() {
    if (!DWClient) {
      logger.warn('钉钉 SDK 不可用，进入模拟模式');
      this.mockMode = true;
      this.connected = true;
      this.debouncedSend = debounce(this.doSend.bind(this), 1000);
      return;
    }

    const AppKey = getDingTalkAppKey();
    const AppSecret = getDingTalkAppSecret();

    logger.info('连接钉钉 WebSocket...');

    try {
      // 创建客户端实例（不过滤 debug 输出）
      this.client = new DWClient({
        clientId: AppKey,
        clientSecret: AppSecret,
        debug: false // 关闭 SDK 内部调试输出
      });

      // 注册消息回调
      this.client.registerCallbackListener(TOPIC_ROBOT, async (msg) => {
        logger.info({
          topic: msg.headers?.topic,
          messageId: msg.headers?.messageId
        }, '📥 收到钉钉机器人消息');

        try {
          await this.handleMessage(msg);
        } catch (err) {
          logger.error({ error: err.message }, '处理消息失败');
        }

        // 手动发送确认，防止钉钉重复发送
        try {
          this.client.send(msg.headers.messageId, { status: 'SUCCESS' });
          logger.debug({ messageId: msg.headers.messageId }, '已发送消息确认');
        } catch (err) {
          logger.warn({ error: err.message }, '发送消息确认失败');
        }
      });

      // 连接
      this.client.connect();

      // 等待连接建立
      await new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 30;

        const checkConnection = setInterval(() => {
          attempts++;
          if (this.client && this.client.connected) {
            clearInterval(checkConnection);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkConnection);
            logger.warn('钉钉连接超时，进入模拟模式');
            this.mockMode = true;
            this.connected = true;
            resolve();
          }
        }, 500);
      });

      if (!this.mockMode) {
        logger.info('钉钉 WebSocket 连接成功');
        this.connected = true;
        this.debouncedSend = debounce(this.doSend.bind(this), 1000);

        // 发送启动消息给配置的用户
        const userId = getDingTalkUserId();
        if (userId) {
          this.sendStartupMessage(userId);
        }
      }

    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, '连接钉钉失败，进入模拟模式');
      this.mockMode = true;
      this.connected = true;
      this.debouncedSend = debounce(this.doSend.bind(this), 1000);
      // 欢迎消息在收到用户第一条消息时发送
    }
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(res) {
    try {
      const data = JSON.parse(res.data);

      // 打印钉钉原始消息数据（用于调试）
      logger.info({
        msgId: data.msgId,
        messageId: data.messageId,
        createAt: data.createAt,
        senderId: data.senderId,
        senderStaffId: data.senderStaffId,
        text: data.text?.content || data.content
      }, '钉钉原始消息');

      // 消息去重：使用消息 ID 防止重复处理
      const msgId = data.msgId || data.messageId || `${data.senderId}_${data.createAt || Date.now()}`;
      if (this.processedMsgIds.has(msgId)) {
        logger.warn({ msgId }, '⏭️ 跳过重复消息');
        return;
      }

      // 记录消息 ID
      this.processedMsgIds.add(msgId);
      logger.info({ msgId }, '✅ 消息已记录');

      let text = '';
      if (data.text && data.text.content) {
        text = data.text.content;
      } else if (data.content) {
        text = data.content;
      }

      this.sessionWebhook = data.sessionWebhook || data.sessionWebhookUrl;
      this.senderId = data.senderId;
      this.senderStaffId = data.senderStaffId;
      this.senderNick = data.senderNick || data.nickName || data.senderName;
      this.userId = this.senderStaffId || this.senderId;

      if (text) {
        // 标记已欢迎（不在收到消息时发送欢迎消息，避免干扰）
        if (!this.hasWelcomed) {
          this.hasWelcomed = true;
        }

        this.emit('text', text, this.userId);
      }

      // 消息确认已通过 registerAllEventListener 的返回值处理
      // 返回 EventAck.SUCCESS 防止钉钉重复发送消息

    } catch (e) {
      logger.error({ error: e.message }, '解析消息失败');
    }
  }

  /**
   * 发送文本（带智能发送策略）
   * @param {string} text - 文本内容
   * @param {object} context - 上下文信息（可选）
   */
  send(text, context = {}) {
    if (!this.connected) {
      logger.warn('未连接钉钉，无法发送消息');
      return;
    }

    // 过滤无意义的内容
    const trimmed = text.trim();

    // 只过滤单字符且非字母数字中文的内容（通常是 ANSI 控制字符残留）
    if (trimmed.length === 1 && !/[a-zA-Z0-9\u4e00-\u9fa5]/.test(trimmed)) {
      logger.debug({ text: trimmed }, '跳过单字符控制符');
      return;
    }

    // 过滤纯 ANSI 控制序列（不包含可见字符）
    if (/^[\x00-\x1f\x7f;\[\d+m\s]+$/.test(trimmed) && !/[a-zA-Z0-9\u4e00-\u9fa5]/.test(trimmed)) {
      logger.debug({ text: trimmed }, '跳过纯 ANSI 控制序列');
      return;
    }

    // 记录发送日志
    const preview = trimmed.length > 50 ? trimmed.slice(0, 50) + '...' : trimmed;
    logger.debug({ text: preview, context, silentMode: this.silentMode }, '📤 send() 调用');

    // 检查是否需要立即发送
    const shouldSend = this.shouldSendNow(text, context);
    logger.info({ shouldSend, context }, '📋 shouldSendNow 结果');

    // 立即发送模式：直接发送新消息，不影响缓冲区
    if (shouldSend) {
      logger.debug({ text: preview }, '📤 触发立即发送');
      // 直接发送当前消息，不混入缓冲区
      const chunks = this.splitChunks(text);
      chunks.forEach((chunk, i) => {
        logger.debug({ index: i + 1, length: chunk.length }, '📤 立即发送消息');
        if (this.mockMode) {
          console.log(chunk);
        } else {
          this.sendToDingTalk(chunk);
        }
      });
      return;
    }

    // 非立即发送：添加到缓冲区
    this.buffer += text;

    // 限制缓冲区大小
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    // 静默模式：不实时发送，保留在缓冲区
    if (this.silentMode) {
      logger.debug({ length: this.buffer.length }, '静默模式：输出已缓冲');
      return;
    }

    // 非静默模式：使用防抖发送
    if (this.mockMode) {
      this.doSend();
      return;
    }

    if (this.debouncedSend) {
      this.debouncedSend();
    }
  }

  /**
   * 判断是否需要立即发送
   * @param {string} text - 文本内容
   * @param {object} context - 上下文信息
   * @returns {boolean}
   */
  shouldSendNow(text, context) {
    // 1. 明确要求立即发送
    if (context.immediate) return true;

    // 2. 任务完成
    if (context.taskCompleted) return true;

    // 3. 交互提示 (y/n, 选项列表等)
    const interactionPatterns = [
      /\(y\/n\)/i,
      /\[y\/n\]/i,
      /\[.*\]/,  // 选项列表 [1] [2] 等
      /选择/,
      /确认/,
      /请输入/,
      /Please (select|choose|confirm)/i,
      /\?$/,  // 以问号结尾
      /^\s*\d+[\.\)]\s/m,  // 编号列表
    ];
    if (interactionPatterns.some(p => p.test(text))) return true;

    // 4. 错误
    if (/error|错误|失败|exception|failed/i.test(text)) return true;

    // 5. HITL 审批提示
    if (/需要审批|审批|批准|拒绝/i.test(text)) return true;

    return false;
  }

  /**
   * 强制立即发送（不经过策略）
   * @param {string} text - 文本内容
   */
  sendImmediate(text) {
    if (!this.connected) {
      logger.warn('未连接钉钉，无法发送消息');
      return;
    }

    logger.info({ length: text.length }, '📤 sendImmediate() 立即发送');

    if (this.mockMode) {
      logger.debug({ content: text }, '📤 [模拟模式] 立即发送');
      console.log(text);
      return;
    }

    this.sendToDingTalk(text);
  }

  /**
   * 手动刷新缓冲区
   */
  flushBuffer() {
    if (this.buffer) {
      logger.debug({ length: this.buffer.length }, '📤 刷新缓冲区');
      this.doSend();
    }
  }

  /**
   * 设置静默模式
   * @param {boolean} silent - 是否静默
   */
  setSilentMode(silent) {
    this.silentMode = silent;
    logger.info({ silent }, `静默模式已${silent ? '启用' : '禁用'}`);
  }

  /**
   * 实际发送（含分片逻辑）
   */
  doSend() {
    if (!this.buffer) return;

    const text = this.buffer;
    this.buffer = '';

    // 分片处理
    const chunks = this.splitChunks(text);

    logger.debug({ chunks: chunks.length, totalLength: text.length }, '📤 doSend() 执行发送');

    if (this.mockMode) {
      chunks.forEach((chunk, i) => {
        logger.debug({ index: i + 1, length: chunk.length }, '📤 [模拟模式] 发送消息');
        console.log(chunk);
      });
      return;
    }

    chunks.forEach((chunk, i) => {
      logger.debug({ index: i + 1, length: chunk.length }, '📤 发送消息到钉钉');
      this.sendToDingTalk(chunk);
    });
  }

  /**
   * 将文本按钉钉消息长度限制分片
   * 超过 2000 字节时按 1950 字节分片，片间保留 50 字节重叠
   * @param {string} text - 待分片文本
   * @returns {string[]} 分片数组
   */
  splitChunks(text) {
    const MAX_CHUNK_SIZE = 2000;
    const CHUNK_SIZE = 1950;
    const OVERLAP = 50;

    if (Buffer.byteLength(text, 'utf8') <= MAX_CHUNK_SIZE) {
      return [text];
    }

    const chunks = [];
    let charOffset = 0;

    while (charOffset < text.length) {
      // 计算当前片的字节边界
      let byteCount = 0;
      let charEnd = charOffset;

      while (charEnd < text.length && byteCount < CHUNK_SIZE) {
        const charBytes = Buffer.byteLength(text[charEnd], 'utf8');
        if (byteCount + charBytes > CHUNK_SIZE) break;
        byteCount += charBytes;
        charEnd++;
      }

      chunks.push(text.slice(charOffset, charEnd));

      if (charEnd >= text.length) break;

      // 下一片从 charEnd - OVERLAP 字节处开始
      // 计算重叠区域的字符数
      let overlapBytes = 0;
      let overlapChars = 0;
      for (let i = charEnd - 1; i >= charOffset && overlapBytes < OVERLAP; i--) {
        overlapBytes += Buffer.byteLength(text[i], 'utf8');
        overlapChars++;
      }
      charOffset = charEnd - overlapChars;
    }

    // 添加序号
    if (chunks.length > 1) {
      return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}] ${chunk}`);
    }

    return chunks;
  }

  /**
   * 发送到钉钉
   * 优先使用 sessionWebhook 被动回复，降级使用 batchSend 主动推送
   */
  async sendToDingTalk(text) {
    try {
      const axios = (await import('axios')).default;
      const accessToken = await this.getAccessToken();

      logger.info({
        hasSessionWebhook: !!this.sessionWebhook,
        textLength: text.length,
        textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      }, '📤 sendToDingTalk() 准备发送');

      // 优先使用 sessionWebhook 被动回复
      if (this.sessionWebhook) {
        try {
          // 使用 markdown 类型发送
          const body = {
            at: { atUserIds: [this.userId], isAtAll: false },
            msgtype: 'markdown',
            markdown: {
              title: 'Claude Code',
              text: text
            }
          };

          logger.info({ url: this.sessionWebhook }, '📤 使用 sessionWebhook 发送');

          const response = await axios({
            url: this.sessionWebhook,
            method: 'POST',
            data: body,
            headers: { 'x-acs-dingtalk-access-token': accessToken }
          });

          logger.debug({ status: response.status }, '✅ sessionWebhook 发送成功');
          return;
        } catch (webhookError) {
          logger.warn({ error: webhookError.message }, 'sessionWebhook 发送失败，尝试降级推送');
        }
      }

      // 降级：使用 batchSend 主动推送
      logger.info('📤 降级使用 batchSend 发送');
      await this.batchSend(text, accessToken);

    } catch (error) {
      logger.error({ error: error.response?.data || error.message }, '发送消息失败');
    }
  }

  /**
   * 使用 batchSend API 主动推送消息
   */
  async batchSend(text, accessToken) {
    const userId = getDingTalkUserId();
    if (!userId) {
      logger.warn('未配置 DINGTALK_USER_ID，无法主动推送消息');
      return;
    }

    const axios = (await import('axios')).default;
    const robotCode = getDingTalkAppKey();

    const body = {
      robotCode: robotCode,
      userIds: [userId],
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({
        title: 'Claude Code',
        text: text
      })
    };

    try {
      logger.info({
        userId,
        robotCode,
        textLength: text.length,
        textPreview: text.slice(0, 200)
      }, '📤 batchSend 发送请求');
      const response = await axios.post(
        'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
        body,
        {
          headers: {
            'x-acs-dingtalk-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
      logger.info({ status: response.status }, '✅ batchSend 发送成功');
    } catch (error) {
      logger.error({ error: error.response?.data || error.message }, 'batchSend 发送失败');
    }
  }

  /**
   * 发送启动消息（主动推送给用户）
   */
  async sendStartupMessage(userId) {
    const rootDir = getAllowedRootDir();
    const startupMsg = `## 🦀 老板，系统已就绪

**当前工作目录:** \`${rootDir}\`

### 📖 OpenHermit 命令（- 前缀）
| 命令 | 说明 |
|------|------|
| \`-cd <目录>\` | 切换工作目录 |
| \`-ls\` | 查看可选目录 |
| \`-claude [任务]\` | 启动 Claude Code |
| \`-status\` | 查看执行状态 |
| \`-help\` | 查看帮助 |

### ⌨️ 快捷指令
| 指令 | 说明 |
|------|------|
| \`esc\` | 终止 Claude 当前任务 |

### 💡 使用说明
- 带 \`-\` 前缀的命令由 OpenHermit 处理
- 其他所有内容直接发送给 Claude 终端`;

    try {
      const accessToken = await this.getAccessToken();
      await this.batchSend(startupMsg, accessToken);
    } catch (error) {
      // 静默失败
    }
  }

  /**
   * 发送欢迎消息
   */
  sendWelcome() {
    const rootDir = getAllowedRootDir();

    // 列出根目录下的子目录
    let dirList = `- \`${rootDir}\``;
    try {
      const items = fs.readdirSync(rootDir);
      const dirs = items.filter(item => {
        try {
          return fs.statSync(`${rootDir}/${item}`).isDirectory();
        } catch { return false; }
      });
      if (dirs.length > 0) {
        dirList = dirs.map(dir => `- \`${rootDir}/${dir}\``).join('\n');
      }
    } catch (e) {
      logger.warn({ error: e.message }, '读取根目录失败');
    }

    const welcomeMsg = `## 🦀 欢迎使用 OpenHermit

**当前工作目录:** \`${rootDir}\`

### 📂 可选目录
${dirList}

### 📖 OpenHermit 命令（- 前缀）
| 命令 | 说明 |
|------|------|
| \`-cd <目录>\` | 切换工作目录 |
| \`-ls\` | 查看可选目录 |
| \`-claude [任务]\` | 启动 Claude Code |
| \`-status\` | 查看执行状态 |
| \`-help\` | 查看帮助 |

### ⌨️ 快捷指令
| 指令 | 说明 |
|------|------|
| \`esc\` | 终止 Claude 当前任务 |

### 💡 使用说明
- 带 \`-\` 前缀的命令由 OpenHermit 处理
- 其他所有内容直接发送给 Claude 终端`;

    this.send(welcomeMsg);
  }

  /**
   * 发送目录列表
   */
  sendDirList(currentDir) {
    const rootDir = getAllowedRootDir();

    let msg = `## 📂 目录列表\n\n**当前工作目录:** \`${currentDir}\`\n**白名单根目录:** \`${rootDir}\`\n\n`;

    try {
      const items = fs.readdirSync(rootDir);
      const dirs = items.filter(item => {
        const fullPath = `${rootDir}/${item}`;
        return fs.statSync(fullPath).isDirectory();
      });

      if (dirs.length > 0) {
        msg += '### 可选目录\n';
        dirs.forEach(dir => msg += `- \`${rootDir}/${dir}\`\n`);
      } else {
        msg += '> 目录下没有子目录';
      }
    } catch (error) {
      msg += `❌ 无法读取目录: ${error.message}`;
    }

    this.send(msg, { immediate: true });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.client && !this.mockMode) {
      try { this.client.disconnect(); } catch (e) {}
    }
    this.connected = false;
    logger.info('钉钉连接已关闭');
  }

  isConnected() {
    return this.connected;
  }

  isMockMode() {
    return this.mockMode;
  }
}

export default DingTalkChannel;
