import { validateConfig, getAllowedRootDir, printEnvironmentInfo } from './config/index.js';
import PTYEngine from './pty/engine.js';
import DingTalkChannel from './channel/dingtalk.js';
import { purify } from './purifier/stripper.js';
import { checkHitl, extractHitlPrompt } from './purifier/hitl.js';
import logger from './utils/logger.js';

// 全局异常处理
process.on('unhandledRejection', (reason, promise) => {
  // 忽略钉钉连接失败（网络问题）
  if (reason && (reason.code === 'ECONNRESET' || reason.code === 'ETIMEDOUT' || reason.code === 'ENOTFOUND')) {
    logger.warn({ code: reason.code, message: reason.message }, '钉钉连接失败，将使用模拟模式');
    return;
  }
  // 打印详细错误信息
  console.error('=== 未处理的 Promise 拒绝 ===');
  console.error('Error:', reason);
  if (reason && reason.stack) {
    console.error('Stack:', reason.stack);
  }
  logger.error({ reason }, '未处理的 Promise 拒绝');
});

process.on('uncaughtException', (error) => {
  logger.error({ error: error.message }, '未捕获的异常');
});

/**
 * OpenHermit 主应用
 */
class OpenHermit {
  constructor() {
    this.pty = new PTYEngine();
    this.channel = new DingTalkChannel();
    this.hitlActive = false;
    this.pausedBuffer = '';
  }

  /**
   * 初始化应用
   */
  async init() {
    // 打印环境信息
    const envCheck = printEnvironmentInfo();

    if (!envCheck.valid) {
      logger.error('环境检查未通过，请修复上述问题后重试');
      process.exit(1);
    }

    // 验证配置
    if (!validateConfig()) {
      logger.error('配置验证失败，请检查 .env 文件');
      process.exit(1);
    }

    // 设置 PTY 数据监听
    this.pty.onData((data) => this.handlePtyData(data));

    // 设置 PTY 退出监听
    this.pty.onExit(({ exitCode, signal }) => {
      logger.warn({ exitCode, signal }, 'PTY 进程退出');
      this.channel.send(`\n⚠️ Claude Code 已退出 (exitCode: ${exitCode})\n请输入 /restart 重新启动\n`);
    });

    // 设置通道消息监听
    this.channel.on('text', (text, senderId) => this.handleChannelText(text, senderId));

    // 设置审批回调监听
    this.channel.on('approve', () => this.handleApprove());
    this.channel.on('reject', () => this.handleReject());

    // 启动 PTY
    this.pty.start();

    // 连接钉钉
    try {
      await this.channel.connect();
    } catch (error) {
      logger.error({ error: error.message }, '连接钉钉失败');
      process.exit(1);
    }

    logger.info('OpenHermit 启动完成');
  }

  /**
   * 处理 PTY 输出数据
   * @param {string} data - PTY 输出
   */
  handlePtyData(data) {
    // 如果处于 HITL 暂停状态，将数据存入缓冲区
    if (this.hitlActive) {
      this.pausedBuffer += data;
      return;
    }

    // 净化数据
    const cleanData = purify(data);

    if (!cleanData) return;

    // 检查 HITL
    if (checkHitl(cleanData)) {
      // 暂停输出
      this.hitlActive = true;
      this.pausedBuffer = data;

      // 发送净化后的内容（到 HITL 提示之前）
      const prompt = extractHitlPrompt(cleanData);
      const contentBeforePrompt = cleanData.slice(0, cleanData.indexOf(prompt));
      if (contentBeforePrompt) {
        this.channel.send(contentBeforePrompt);
      }

      // 发送审批卡片
      this.channel.sendActionCard(prompt);
      return;
    }

    // 正常发送
    this.channel.send(cleanData);
  }

  /**
   * 处理钉钉收到的文本
   * @param {string} text - 文本内容
   * @param {string} senderId - 发送者 ID
   */
  handleChannelText(text, senderId) {
    const trimmed = text.trim();

    // HITL 激活状态下，优先处理 y/n 回复
    if (this.hitlActive) {
      const lower = trimmed.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        this.handleApprove();
        return;
      } else if (lower === 'n' || lower === 'no') {
        this.handleReject();
        return;
      }
      // 其他文本提示用户先处理审批
      this.channel.send('⚠️ 当前有待审批的操作，请先回复 y(同意) 或 n(拒绝)');
      return;
    }

    // 内置命令处理
    if (trimmed.startsWith('/')) {
      this.handleCommand(trimmed);
      return;
    }

    // 写入 PTY
    this.pty.write(text + '\r');
  }

  /**
   * 处理内置命令
   * @param {string} command - 命令
   */
  handleCommand(command) {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/cd':
        this.handleCd(args);
        break;
      case '/ls':
        this.handleLs();
        break;
      case '/restart':
        this.handleRestart();
        break;
      default:
        this.channel.send(`未知命令: ${cmd}\n可用命令: /cd, /ls, /restart`);
    }
  }

  /**
   * 处理 /cd 命令
   * @param {string} path - 目标路径
   */
  handleCd(path) {
    if (!path) {
      this.channel.send('用法: /cd <目录路径>');
      return;
    }

    // 处理相对路径
    let targetPath = path;
    if (!path.startsWith('/')) {
      targetPath = `${this.pty.getWorkingDir()}/${path}`;
    }

    const success = this.pty.setWorkingDir(targetPath);

    if (success) {
      this.channel.send(`✅ 已切换到: ${this.pty.getWorkingDir()}`);
    } else {
      const rootDir = getAllowedRootDir();
      this.channel.send(`❌ 切换失败: 仅允许在 ${rootDir} 下操作`);
    }
  }

  /**
   * 处理 /ls 命令
   */
  handleLs() {
    this.channel.sendDirList(this.pty.getWorkingDir());
  }

  /**
   * 处理 /restart 命令
   */
  handleRestart() {
    this.channel.send('🔄 正在重启 Claude Code...');
    this.pty.restart();
    this.channel.send('✅ Claude Code 已重启，请输入 claude 启动');
  }

  /**
   * 处理审批同意
   */
  handleApprove() {
    if (!this.hitlActive) return;

    // 恢复输出
    this.hitlActive = false;

    // 发送批准消息
    this.channel.send('\n✅ 已批准，继续执行...\n');

    // 写入 y 到 PTY
    this.pty.write('y\r');

    // 清空缓冲区
    this.pausedBuffer = '';
  }

  /**
   * 处理审批拒绝
   */
  handleReject() {
    if (!this.hitlActive) return;

    // 恢复输出
    this.hitlActive = false;

    // 发送拒绝消息
    this.channel.send('\n❌ 已拒绝，命令未执行\n');

    // 写入 n 到 PTY
    this.pty.write('n\r');

    // 清空缓冲区
    this.pausedBuffer = '';
  }

  /**
   * 停止应用
   */
  stop() {
    logger.info('停止 OpenHermit...');
    this.pty.kill();
    this.channel.disconnect();
  }
}

// 启动应用
const app = new OpenHermit();

app.init().catch(error => {
  logger.error({ error: error.message }, '启动失败');
  process.exit(1);
});

// 优雅退出
process.on('SIGINT', () => {
  logger.info('收到 SIGINT 信号');
  app.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号');
  app.stop();
  process.exit(0);
});

export default app;
