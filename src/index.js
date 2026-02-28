#!/usr/bin/env node

import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

// 解析命令行参数（在导入其他模块之前）
const args = process.argv.slice(2);

// 显示版本号
if (args.includes('-v') || args.includes('--version')) {
  console.log(`openhermit v${packageJson.version}`);
  process.exit(0);
}

// 显示帮助
if (args.includes('-h') || args.includes('--help')) {
  console.log(`
OpenHermit (开源寄居蟹) v${packageJson.version}

用法:
  openhermit           启动服务
  openhermit -v        显示版本号
  openhermit update    更新到最新版本
  openhermit -h        显示帮助信息

详细使用文档:
https://github.com/codelogickeep/openhermit/blob/main/README.md
`);
  process.exit(0);
}

// 更新包
if (args[0] === 'update') {
  console.log('正在更新 @codelogickeep/open-hermit...');
  try {
    execSync('npm update -g @codelogickeep/open-hermit', { stdio: 'inherit' });
    console.log('更新完成！');
  } catch (error) {
    console.error('更新失败，请手动执行: npm update -g @codelogickeep/open-hermit');
    process.exit(1);
  }
  process.exit(0);
}

// 以下是正常启动逻辑（使用动态 import）
const { validateConfig, getAllowedRootDir, printEnvironmentInfo, getDashScopeApiKey } = await import('./config/index.js');
const { default: PTYEngine } = await import('./pty/engine.js');
const { default: DingTalkChannel } = await import('./channel/dingtalk.js');
const { purify } = await import('./purifier/stripper.js');
const { checkHitl, extractHitlPrompt } = await import('./purifier/hitl.js');
const { default: logger } = await import('./utils/logger.js');
const { getIntentParser, IntentTypes } = await import('./intent/index.js');
const { getMarkdownFormatter } = await import('./formatter/index.js');
const { getSelectionDetector, getSelectionHandler } = await import('./selector/index.js');

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
    this.intentParser = getIntentParser();
    this.formatter = getMarkdownFormatter();
    this.selectionDetector = getSelectionDetector();
    this.selectionHandler = getSelectionHandler();
    this.smartMode = !!getDashScopeApiKey(); // 智能模式：是否启用了 LLM
    this.waitingForSelection = false; // 是否等待用户选择

    // PTY 输出处理队列
    this.ptyQueue = [];
    this.isProcessingPty = false;

    if (this.smartMode) {
      logger.info('智能交互模式已启用');
    }
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
    this.pty.onData((data) => {
      this.handlePtyData(data);
    });

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
    // 将数据加入队列
    this.ptyQueue.push(data);

    // 如果没有在处理，开始处理
    if (!this.isProcessingPty) {
      this.processPtyQueue();
    }
  }

  /**
   * 处理 PTY 输出队列
   */
  async processPtyQueue() {
    if (this.ptyQueue.length === 0) {
      this.isProcessingPty = false;
      return;
    }

    this.isProcessingPty = true;

    // 取出所有待处理的数据并合并
    const allData = this.ptyQueue.join('');
    this.ptyQueue = [];

    try {
      await this.processPtyData(allData);
    } catch (error) {
      logger.error({ error: error.message }, '处理 PTY 数据失败');
    }

    // 继续处理队列中可能新加入的数据
    await this.processPtyQueue();
  }

  /**
   * 实际处理 PTY 数据
   * @param {string} data - PTY 输出
   */
  async processPtyData(data) {
    // 如果处于 HITL 暂停状态，将数据存入缓冲区
    if (this.hitlActive) {
      this.pausedBuffer += data;
      return;
    }

    // 净化数据
    const cleanData = purify(data);

    if (!cleanData) return;

    // 打印日志
    logger.debug({ data: cleanData.substring(0, 100) }, 'PTY 输出');

    // 检查 HITL（原有的危险命令审批逻辑）
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

    // 智能模式：检测选择提示（只检测，不格式化）
    if (this.smartMode && !this.waitingForSelection) {
      const selection = await this.selectionDetector.detect(cleanData);
      if (selection) {
        // 更新会话状态
        const session = this.intentParser.getSession();
        session.setSelection(selection.options, selection.context);
        this.waitingForSelection = true;

        // 格式化并发送选择提示
        const formattedPrompt = this.selectionDetector.formatSelectionPrompt(selection);
        this.channel.send(cleanData + formattedPrompt);
        return;
      }
    }

    // 格式化输出为 Markdown
    const formattedData = this.formatter.basicFormat(cleanData);
    if (formattedData) {
      this.channel.send(formattedData);
    }
  }


  /**
   * 处理钉钉收到的文本
   * @param {string} text - 文本内容
   * @param {string} senderId - 发送者 ID
   */
  async handleChannelText(text, senderId) {
    const trimmed = text.trim();

    // 打印接收日志
    logger.info({ text: trimmed, senderId }, '收到钉钉消息');

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

    // 智能模式：使用意图解析器
    if (this.smartMode) {
      await this.handleWithIntentParsing(trimmed);
      return;
    }

    // 传统模式：简单命令匹配
    // 内置命令处理
    if (trimmed.startsWith('/')) {
      this.handleCommand(trimmed);
      return;
    }

    // 写入 PTY
    this.pty.write(text + '\r');
  }

  /**
   * 使用意图解析处理用户消息
   * @param {string} userMessage - 用户消息
   */
  async handleWithIntentParsing(userMessage) {
    try {
      const intent = await this.intentParser.parse(userMessage);
      logger.info({ intent }, '意图解析结果');

      switch (intent.type) {
        case IntentTypes.BUILT_IN:
          // 内置命令
          this.handleCommand(`${intent.command}${intent.params.path ? ' ' + intent.params.path : ''}`);
          break;

        case IntentTypes.SHELL_COMMAND:
          // 直接执行 shell 命令
          logger.info({ command: intent.command }, '执行 shell 命令');
          this.channel.send(`🔧 执行命令: ${intent.command}`);
          this.pty.write(intent.command + '\r');
          break;

        case IntentTypes.CLAUDE_COMMAND:
          // Claude Code 命令
          this.executeClaudeCommand(intent.command, intent.params);
          break;

        case IntentTypes.CONVERSATION:
          // 对话交互
          this.handleConversation(intent);
          break;

        default:
          // 默认：写入 PTY
          this.pty.write(userMessage + '\r');
      }
    } catch (error) {
      logger.error({ error: error.message }, '意图解析失败');
      // 降级：直接写入 PTY
      this.pty.write(userMessage + '\r');
    }
  }

  /**
   * 执行 Claude 命令
   * @param {string} command - 命令内容
   * @param {object} params - 参数
   */
  executeClaudeCommand(command, params = {}) {
    const session = this.intentParser.getSession();

    // 如果明确指定了 claude 命令或当前不在 claude 活动状态
    if (params.explicit || session.mode === 'idle') {
      // 启动 Claude Code 并传入命令（使用单引号防止 shell 注入）
      const escaped = command.replace(/'/g, "'\\''");
      const claudeCmd = `claude '${escaped}'`;
      this.channel.send(`🚀 启动 Claude Code: ${command}`);
      this.pty.write(claudeCmd + '\r');
      session.setMode('claude_active');
    } else {
      // 已在 Claude 会话中，直接发送消息
      this.pty.write(command + '\r');
    }
  }

  /**
   * 处理对话交互
   * @param {object} intent - 意图对象
   */
  async handleConversation(intent) {
    const session = this.intentParser.getSession();

    if (intent.command === 'confirm') {
      // y/n 确认
      this.pty.write(intent.params.value + '\r');
      return;
    }

    if (intent.command === 'select') {
      // 使用选择处理器
      const lastSelection = this.selectionDetector.getLastSelection();
      if (lastSelection) {
        const result = await this.selectionHandler.handle(lastSelection, String(intent.params.choice));
        // arrow 方法已自带 \r，其他方法需追加
        const input = result.method === 'arrow' ? result.input : result.input + '\r';
        this.pty.write(input);
        this.waitingForSelection = false;
        session.clearSelection();
        this.selectionDetector.clearLastSelection();
      } else {
        // 没有选择上下文，直接发送
        const choice = intent.params.choice;
        this.pty.write((typeof choice === 'string' ? choice : String(choice)) + '\r');
      }
      return;
    }

    // 其他对话：直接发送
    this.pty.write(intent.command + '\r');
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
