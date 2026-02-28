import fs from 'fs';
import { EventEmitter } from 'events';
import { getDingTalkAppKey, getDingTalkAppSecret, getAllowedRootDir, getDingTalkUserId } from '../config/index.js';
import logger from '../utils/logger.js';
import debounce from 'lodash.debounce';

// 动态导入 ESM 模块
let DWClient;
let TOPIC_ROBOT;
try {
  const module = await import('dingtalk-stream-sdk-nodejs');
  DWClient = module.DWClient;
  TOPIC_ROBOT = module.TOPIC_ROBOT;
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
      this.debouncedSend = debounce(this.doSend.bind(this), 1500);
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
      this.client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
        await this.handleMessage(res);
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
        this.debouncedSend = debounce(this.doSend.bind(this), 1500);

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
      this.debouncedSend = debounce(this.doSend.bind(this), 1500);
      // 欢迎消息在收到用户第一条消息时发送
    }
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(res) {
    try {
      const data = JSON.parse(res.data);

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
        logger.info({
          text,
          senderId: this.senderId,
          senderStaffId: this.senderStaffId,
          senderNick: this.senderNick
        }, '收到文本消息');

        // 如果是第一条消息，发送欢迎消息
        if (!this.hasWelcomed) {
          this.hasWelcomed = true;
          this.sendWelcome();
        }

        this.emit('text', text, this.userId);
      }

      // 响应确认（可选，钉钉会自动确认）
      // 不调用 callback，让钉钉自动确认

    } catch (e) {
      logger.error({ error: e.message }, '解析消息失败');
    }
  }

  /**
   * 发送文本
   */
  send(text) {
    if (!this.connected) {
      logger.warn('未连接钉钉，无法发送消息');
      return;
    }

    this.buffer += text;

    if (this.mockMode) {
      this.doSend();
      return;
    }

    if (this.debouncedSend) {
      this.debouncedSend();
    }
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

    if (this.mockMode) {
      chunks.forEach(chunk => {
        logger.debug({ length: chunk.length }, '[模拟钉钉消息]');
        console.log(chunk);
      });
      return;
    }

    chunks.forEach(chunk => this.sendToDingTalk(chunk));
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

      // 优先使用 sessionWebhook 被动回复
      if (this.sessionWebhook) {
        try {
          const body = {
            at: { atUserIds: [this.userId], isAtAll: false },
            text: { content: text },
            msgtype: 'text'
          };

          await axios({
            url: this.sessionWebhook,
            method: 'POST',
            data: body,
            headers: { 'x-acs-dingtalk-access-token': accessToken }
          });

          return;
        } catch (webhookError) {
          logger.warn({ error: webhookError.message }, 'sessionWebhook 发送失败，尝试降级推送');
        }
      }

      // 降级：使用 batchSend 主动推送
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
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: text })
    };

    try {
      await axios.post(
        'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend',
        body,
        {
          headers: {
            'x-acs-dingtalk-access-token': accessToken,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      logger.error({ error: error.response?.data || error.message }, 'batchSend 发送失败');
    }
  }

  /**
   * 发送启动消息（主动推送给用户）
   */
  async sendStartupMessage(userId) {
    const rootDir = getAllowedRootDir();
    const startupMsg = `🦀 老板，系统已就绪，请下达指令。

当前工作目录: ${rootDir}

常用命令:
/cd <目录>  - 切换工作目录
/ls         - 查看可选目录
/restart    - 重启 Claude Code

直接发送你的需求即可，我会立即响应！`;

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
    let dirList = `  - ${rootDir}`;
    try {
      const items = fs.readdirSync(rootDir);
      const dirs = items.filter(item => {
        try {
          return fs.statSync(`${rootDir}/${item}`).isDirectory();
        } catch { return false; }
      });
      if (dirs.length > 0) {
        dirList = dirs.map(dir => `  - ${rootDir}/${dir}`).join('\n');
      }
    } catch (e) {
      logger.warn({ error: e.message }, '读取根目录失败');
    }

    const welcomeMsg = `🦀 欢迎使用 OpenHermit

当前工作目录: ${rootDir}
可选目录:
${dirList}

命令:
  /cd <目录>  切换工作目录
  /ls         查看可选目录
  /restart    重启 Claude Code

请先使用 /cd 切换到项目目录，然后输入 claude 启动。`;

    this.send(welcomeMsg);
  }

  /**
   * 发送目录列表
   */
  sendDirList(currentDir) {
    const rootDir = getAllowedRootDir();

    let msg = `当前工作目录: ${currentDir}\n白名单根目录: ${rootDir}\n\n`;

    try {
      const items = fs.readdirSync(rootDir);
      const dirs = items.filter(item => {
        const fullPath = `${rootDir}/${item}`;
        return fs.statSync(fullPath).isDirectory();
      });

      if (dirs.length > 0) {
        msg += '可选目录:\n';
        dirs.forEach(dir => msg += `  - ${rootDir}/${dir}\n`);
      } else {
        msg += '目录下没有子目录';
      }
    } catch (error) {
      msg += `无法读取目录: ${error.message}`;
    }

    this.send(msg);
  }

  /**
   * 发送 ActionCard
   */
  sendActionCard(prompt) {
    const cardMsg = `\n⚠️ 需要审批\n${prompt || '检测到危险命令，需要您的审批'}\n请回复 'y' 同意 或 'n' 拒绝\n`;
    this.send(cardMsg);
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
