import { Readable } from 'stream';
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
        logger.info({ res }, '收到消息');
        // 打印消息详情，包含 senderStaffId，供用户配置 DINGTALK_USER_ID
        console.log('=== DingTalk 消息详情 ===');
        console.log(JSON.stringify(res, null, 2));
        console.log('=========================');
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
          logger.info({ userId }, '发送启动消息给用户');
          this.sendStartupMessage(userId);
        } else {
          logger.info('未配置 DINGTALK_USER_ID，跳过启动消息');
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
      console.log('=== 钉钉消息完整数据 ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('=========================');
      logger.info({ data }, '解析消息');

      let text = '';
      if (data.text && data.text.content) {
        text = data.text.content;
      } else if (data.content) {
        text = data.content;
      }

      this.sessionWebhook = data.sessionWebhook || data.sessionWebhookUrl;
      this.userId = data.senderId || data.senderStaffId;

      if (text) {
        logger.info({ text, senderId: this.userId }, '收到文本消息');

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
   * 实际发送
   */
  doSend() {
    if (!this.buffer) return;

    const text = this.buffer;
    this.buffer = '';

    if (this.mockMode) {
      console.log('\n--- [模拟钉钉消息] ---');
      console.log(text);
      console.log('-----------------------\n');
      return;
    }

    this.sendToDingTalk(text);
  }

  /**
   * 发送到钉钉
   * 优先使用 sessionWebhook 被动回复，降级使用 batchSend 主动推送
   */
  async sendToDingTalk(text) {
    try {
      const axios = (await import('axios')).default;
      const AppKey = getDingTalkAppKey();
      const AppSecret = getDingTalkAppSecret();

      // 获取 access_token
      const tokenResult = await axios.get(
        `https://oapi.dingtalk.com/gettoken?appkey=${AppKey}&appsecret=${AppSecret}`
      );
      const accessToken = tokenResult.data.access_token;

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

          logger.info('消息发送成功（sessionWebhook）');
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

      logger.info('消息发送成功（batchSend 主动推送）');
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
/claude     - 启动 Claude Code

直接发送你的需求即可，我会立即响应！`;

    // 使用钉钉发送消息 API
    try {
      const axios = (await import('axios')).default;
      const AppKey = getDingTalkAppKey();
      const AppSecret = getDingTalkAppSecret();

      // 获取 access_token
      const tokenResult = await axios.get(
        `https://oapi.dingtalk.com/gettoken?appkey=${AppKey}&appsecret=${AppSecret}`
      );
      const accessToken = tokenResult.data.access_token;

      // 发送消息给用户
      await axios.post(
        `https://oapi.dingtalk.com/robot/send?access_token=${accessToken}`,
        {
          msgtype: 'text',
          text: {
            content: startupMsg
          },
          userId: userId  // 使用 userId 发送
        }
      );

      logger.info('启动消息已发送');
    } catch (error) {
      logger.error({ error: error.message }, '发送启动消息失败');
    }
  }

  /**
   * 发送欢迎消息
   */
  sendWelcome() {
    const rootDir = getAllowedRootDir();
    const welcomeMsg = `🦀 欢迎使用 OpenHermit

当前工作目录: ${rootDir}
可选目录:
  - ${rootDir}

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
    const fs = require('fs');

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
