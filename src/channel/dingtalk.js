import { Readable } from 'stream';
import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { getDingTalkAppKey, getDingTalkAppSecret, getAllowedRootDir } from '../config/index.js';
import logger from '../utils/logger.js';
import debounce from 'lodash.debounce';

// 使用 createRequire 导入 CommonJS 模块
const require = createRequire(import.meta.url);
let DingTalkClient;
try {
  DingTalkClient = require('dingtalk-stream-sdk-nodejs');
} catch (e) {
  logger.warn('无法加载钉钉 SDK，将使用模拟模式');
  DingTalkClient = null;
}

/**
 * 钉钉通道网关
 * 处理与钉钉 WebSocket 连接的建立、消息收发
 */
class DingTalkChannel extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.buffer = '';
    this.debouncedSend = null;
    this.connected = false;
    this.userId = null;
    this.mockMode = false; // 模拟模式
  }

  /**
   * 连接到钉钉
   */
  async connect() {
    // 如果没有 SDK，直接进入模拟模式
    if (!DingTalkClient) {
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
      // 创建钉钉客户端实例
      this.client = new DingTalkClient(AppKey, AppSecret);
      this.client.debug = true;

      // 注册消息回调
      this.client.registerRobotCallbackFunction((msg) => {
        this.handleMessage(msg);
      });

      // 连接
      this.client.connect();

      // 等待连接建立（最多等待 15 秒）
      await new Promise((resolve) => {
        let attempts = 0;
        const maxAttempts = 30; // 15 秒 (30 * 500ms)

        const checkConnection = setInterval(() => {
          attempts++;
          if (this.client && this.client.connected) {
            clearInterval(checkConnection);
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkConnection);
            // 超时后进入模拟模式
            logger.warn('钉钉连接超时，进入模拟模式');
            this.mockMode = true;
            this.connected = true;
            resolve();
          }
        }, 500);
      });

      if (!this.mockMode) {
        logger.info('钉钉 WebSocket 连接成功');
      } else {
        logger.info('模拟模式：钉钉连接超时，使用模拟模式');
      }

      // 设置防抖发送
      this.debouncedSend = debounce(this.doSend.bind(this), 1500);

      // 发送欢迎消息
      this.sendWelcome();

    } catch (error) {
      logger.error({ error: error.message }, '连接钉钉失败，进入模拟模式');
      // 进入模拟模式
      this.mockMode = true;
      this.connected = true;

      // 设置防抖发送
      this.debouncedSend = debounce(this.doSend.bind(this), 1500);

      // 模拟模式也发送欢迎消息
      this.sendWelcome();
    }
  }

  /**
   * 处理收到的消息
   * @param {object} message - 消息对象
   */
  handleMessage(message) {
    logger.debug({ message }, '收到消息');

    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message;

      // 提取文本内容
      let text = '';
      if (data.text && data.text.content) {
        text = data.text.content;
      } else if (data.content) {
        text = data.content;
      }

      const senderId = data.senderId || data.senderId || 'unknown';

      if (text) {
        this.userId = senderId;
        logger.info({ senderId, text }, '收到文本消息');
        this.emit('text', text, senderId);
      }
    } catch (e) {
      logger.error({ error: e.message }, '解析消息失败');
    }
  }

  /**
   * 发送文本到钉钉
   * @param {string} text - 要发送的文本
   */
  send(text) {
    if (!this.connected) {
      logger.warn('未连接钉钉，无法发送消息');
      return;
    }

    // 添加到缓冲区
    this.buffer += text;

    // 模拟模式：立即发送
    if (this.mockMode) {
      this.doSend();
      return;
    }

    // 防抖发送
    if (this.debouncedSend) {
      this.debouncedSend();
    }
  }

  /**
   * 实际发送消息（处理分片）
   */
  doSend() {
    if (!this.buffer) return;

    const text = this.buffer;
    this.buffer = '';

    // 模拟模式：打印到控制台
    if (this.mockMode) {
      console.log('\n--- [模拟钉钉消息] ---');
      console.log(text);
      console.log('-----------------------\n');
      return;
    }

    // 检查是否需要分片
    const maxLength = 2000;
    const bytes = Buffer.byteLength(text, 'utf8');

    if (bytes <= maxLength) {
      this.doSendSingle(text);
      return;
    }

    // 需要分片
    logger.info({ bytes }, '消息超长，进行分片');

    // 计算分片数
    const chunkSize = 1950;
    const overlap = 50;
    const totalChunks = Math.ceil(bytes / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      let start = i * chunkSize;
      let end = Math.min(start + chunkSize, text.length);

      // 重叠处理
      if (i > 0) {
        start -= overlap;
      }

      const chunk = text.slice(start, end);
      const header = `[${i + 1}/${totalChunks}] `;
      const chunkWithHeader = header + chunk;

      // 分片发送间隔 100ms，避免触发限流
      setTimeout(() => {
        this.doSendSingle(chunkWithHeader);
      }, i * 100);
    }
  }

  /**
   * 发送单条消息
   * @param {string} text - 消息文本
   */
  doSendSingle(text) {
    if (!this.client || !this.connected) {
      logger.warn('未连接钉钉，无法发送消息');
      return;
    }

    try {
      const msgData = {
        msgtype: 'text',
        text: {
          content: text
        }
      };

      this.emit('send', text);
      logger.debug({ length: text.length }, '消息已发送');
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
   * @param {string} currentDir - 当前目录
   */
  sendDirList(currentDir) {
    const rootDir = getAllowedRootDir();

    let msg = `当前工作目录: ${currentDir}\n`;
    msg += `白名单根目录: ${rootDir}\n\n`;

    // 模拟模式：显示提示
    if (this.mockMode) {
      msg += '（模拟模式：无法读取目录）\n';
      this.send(msg);
      return;
    }

    const fs = require('fs');
    // 列出白名单根目录下的子目录
    try {
      const items = fs.readdirSync(rootDir);
      const dirs = items.filter(item => {
        const fullPath = `${rootDir}/${item}`;
        return fs.statSync(fullPath).isDirectory();
      });

      if (dirs.length > 0) {
        msg += '可选目录:\n';
        dirs.forEach(dir => {
          msg += `  - ${rootDir}/${dir}\n`;
        });
      } else {
        msg += '目录下没有子目录';
      }
    } catch (error) {
      msg += `无法读取目录: ${error.message}`;
    }

    this.send(msg);
  }

  /**
   * 发送 ActionCard（审批卡片）
   * @param {string} prompt - 审批提示内容
   */
  sendActionCard(prompt) {
    if (!this.connected) {
      logger.warn('未连接钉钉，无法发送 ActionCard');
      return;
    }

    // 模拟模式或无法发送 ActionCard 时，使用文本消息
    const cardMsg = `\n⚠️ 需要审批\n${prompt || '检测到危险命令，需要您的审批'}\n请回复 'y' 同意 或 'n' 拒绝\n`;

    this.send(cardMsg);
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.client && !this.mockMode) {
      try {
        this.client.disconnect();
      } catch (e) {
        // 忽略断开错误
      }
    }
    this.connected = false;
    logger.info('钉钉连接已关闭');
  }

  /**
   * 检查是否已连接
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }

  /**
   * 检查是否在模拟模式
   * @returns {boolean}
   */
  isMockMode() {
    return this.mockMode;
  }
}

export default DingTalkChannel;
