import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { getDingTalkAppKey, getDingTalkAppSecret, getAllowedRootDir } from '../config/index.js';
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
      this.sendWelcome();
      return;
    }

    const AppKey = getDingTalkAppKey();
    const AppSecret = getDingTalkAppSecret();

    logger.info('连接钉钉 WebSocket...');

    try {
      // 创建客户端实例
      this.client = new DWClient({
        clientId: AppKey,
        clientSecret: AppSecret,
        debug: true
      });

      // 注册消息回调
      this.client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
        logger.info({ res }, '收到消息');
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
        this.sendWelcome();
      }

    } catch (error) {
      logger.error({ error: error.message, stack: error.stack }, '连接钉钉失败，进入模拟模式');
      this.mockMode = true;
      this.connected = true;
      this.debouncedSend = debounce(this.doSend.bind(this), 1500);
      this.sendWelcome();
    }
  }

  /**
   * 处理收到的消息
   */
  async handleMessage(res) {
    try {
      const data = JSON.parse(res.data);
      logger.info({ data }, '解析消息');

      let text = '';
      if (data.text && data.text.content) {
        text = data.text.content;
      } else if (data.content) {
        text = data.content;
      }

      this.sessionWebhook = data.sessionWebhook;
      this.userId = data.senderId;

      if (text) {
        logger.info({ text, senderId: this.userId }, '收到文本消息');
        this.emit('text', text, this.userId);
      }

      // 响应确认
      if (this.client) {
        this.client.socketCallBackResponse(res.headers?.messageId, { code: 200 });
      }

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
   */
  async sendToDingTalk(text) {
    if (!this.sessionWebhook) {
      logger.warn('无可用 sessionWebhook，无法发送消息');
      return;
    }

    try {
      const axios = (await import('axios')).default;
      const accessToken = await this.client.getAccessToken();

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

      logger.info('消息发送成功');
    } catch (error) {
      logger.error({ error: error.message }, '发送消息失败');
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
