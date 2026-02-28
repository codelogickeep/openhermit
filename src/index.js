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
const { getLLMClient } = await import('./llm/index.js');

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
    this.llmClient = getLLMClient();
    this.smartMode = !!getDashScopeApiKey(); // 智能模式：是否启用了 LLM

    // 终端输出缓冲区（用于 LLM 上下文分析）
    this.terminalBuffer = '';
    this.maxBufferSize = 5000; // 最大缓冲区大小

    // PTY 输出处理队列
    this.ptyQueue = [];
    this.isProcessingPty = false;

    // 任务状态
    this.taskStatus = {
      isRunning: false,
      startTime: null,
      phase: 'idle'  // idle | thinking | acting | waiting_input | completed
    };

    // 输出缓冲（静默模式）
    this.outputBuffer = {
      silent: true,  // 静默模式（不实时发送）
      pending: '',
      maxSize: 10000  // 最大缓冲区大小
    };

    if (this.smartMode) {
      logger.info('智能交互模式已启用');
    }
  }

  /**
   * 初始化并测试 LLM 连接
   */
  async initLLM() {
    const llmClient = getLLMClient();

    // 初始化 LLM 客户端
    if (!llmClient.isAvailable()) {
      logger.warn('LLM 客户端初始化失败，智能功能将不可用');
      this.smartMode = false;
      return;
    }

    // 测试 LLM 连接
    logger.info('正在测试 LLM 连接...');
    try {
      const start = Date.now();
      const response = await llmClient.chat('Hello', {
        maxTokens: 10,
        systemPrompt: '你是一个测试助手。请简短回复。'
      });
      const elapsed = Date.now() - start;
      logger.info({ model: llmClient.model, elapsed: `${elapsed}ms` }, 'LLM 连接测试成功');
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 连接测试失败');
      logger.warn('智能功能将不可用，仅使用规则匹配模式');
      this.smartMode = false;
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

    // 初始化并测试 LLM 连接（如果配置了 DashScope API Key）
    if (this.smartMode) {
      await this.initLLM();
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

    // 记录终端输出到日志（完整输出）
    logger.info({ output: cleanData, length: cleanData.length }, '📺 终端输出');

    // 保存到终端缓冲区（用于 LLM 上下文分析）
    this.terminalBuffer += cleanData;
    if (this.terminalBuffer.length > this.maxBufferSize) {
      this.terminalBuffer = this.terminalBuffer.slice(-this.maxBufferSize);
    }

    // 保存到输出缓冲区
    this.outputBuffer.pending += cleanData;
    if (this.outputBuffer.pending.length > this.outputBuffer.maxSize) {
      this.outputBuffer.pending = this.outputBuffer.pending.slice(-this.outputBuffer.maxSize);
    }

    // 更新任务状态
    this.updateTaskStatus(cleanData);

    // 检查 HITL（原有的危险命令审批逻辑）
    if (checkHitl(cleanData)) {
      // 暂停输出
      this.hitlActive = true;
      this.pausedBuffer = data;

      // 发送净化后的内容（到 HITL 提示之前）
      const prompt = extractHitlPrompt(cleanData);
      const contentBeforePrompt = cleanData.slice(0, cleanData.indexOf(prompt));
      if (contentBeforePrompt) {
        this.channel.send(contentBeforePrompt, { immediate: true });
      }

      // 发送审批提示
      const cardMsg = `\n⚠️ 需要审批\n${prompt || '检测到危险命令，需要您的审批'}\n请回复 'y' 同意 或 'n' 拒绝\n`;
      this.channel.send(cardMsg, { immediate: true });
      return;
    }

    // 检测任务是否完成
    const isCompleted = this.checkTaskCompletion(cleanData);

    // 格式化输出为 Markdown
    let formattedData;
    if (this.smartMode && cleanData.length > 100) {
      // 使用 LLM 格式化（复杂输出）
      try {
        formattedData = await this.formatter.format(cleanData);
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 格式化失败，使用基本格式化');
        formattedData = this.formatter.basicFormat(cleanData);
      }
    } else {
      // 使用基本格式化（简单输出）
      formattedData = this.formatter.basicFormat(cleanData);
    }

    if (formattedData) {
      // 发送时带上上下文（任务完成状态）
      this.channel.send(formattedData, { taskCompleted: isCompleted });
    }
  }

  /**
   * 更新任务状态
   * @param {string} data - PTY 输出数据
   */
  updateTaskStatus(data) {
    const session = this.intentParser.getSession();

    // 检测任务开始
    if (session.mode === 'claude_active' && !this.taskStatus.isRunning) {
      this.taskStatus.isRunning = true;
      this.taskStatus.startTime = Date.now();
      this.taskStatus.phase = 'thinking';
    }

    // 检测等待输入
    if (/\(y\/n\)|\[.*\]|选择|确认|请输入|\?$/i.test(data)) {
      this.taskStatus.phase = 'waiting_input';
    } else if (this.taskStatus.phase === 'waiting_input') {
      // 恢复到 thinking
      this.taskStatus.phase = 'thinking';
    }
  }

  /**
   * 检测任务是否完成
   * @param {string} data - PTY 输出数据
   * @returns {boolean}
   */
  checkTaskCompletion(data) {
    // 任务完成标志
    const completionPatterns = [
      /completed|finished|done|完成|成功/i,
      /✓|✔|✅/,
      /任务.*完成/,
      /已.*完成/,
      /successfully/i
    ];

    const isCompleted = completionPatterns.some(p => p.test(data));

    if (isCompleted) {
      this.taskStatus.phase = 'completed';
      this.taskStatus.isRunning = false;
      logger.info('任务完成检测：检测到完成标志');
    }

    return isCompleted;
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

    // 内置命令处理（优先级最高）
    if (trimmed.startsWith('/')) {
      this.handleCommand(trimmed);
      return;
    }

    // 根据 session mode 分发消息
    const session = this.intentParser.getSession();

    if (session.mode === 'idle') {
      // 启动前：使用 LLM 意图解析
      await this.handleIdleMessage(trimmed);
    } else {
      // 启动后：检测交互则 LLM 解析，否则直接透传
      await this.handleActiveMessage(trimmed);
    }
  }

  /**
   * 处理空闲模式下的消息（Claude 启动前）
   * @param {string} userMessage - 用户消息
   */
  async handleIdleMessage(userMessage) {
    // 智能模式：使用 LLM 意图解析
    if (this.smartMode) {
      try {
        const intent = await this.intentParser.parse(userMessage);
        logger.info({ intent }, '意图解析结果');

        if (intent.type === IntentTypes.CLAUDE_COMMAND) {
          this.executeClaudeCommand(intent.command, intent.params);
          return;
        }

        if (intent.type === IntentTypes.SHELL_COMMAND) {
          logger.info({ command: intent.command }, '执行 shell 命令');
          this.channel.send(`🔧 执行命令: ${intent.command}`);
          this.pty.write(intent.command + '\r');
          return;
        }

        if (intent.type === IntentTypes.BUILT_IN) {
          this.handleCommand(`${intent.command}${intent.params.path ? ' ' + intent.params.path : ''}`);
          return;
        }

        // 默认：尝试作为 Claude 命令
        this.executeClaudeCommand(userMessage, { explicit: true });
      } catch (error) {
        logger.error({ error: error.message }, '意图解析失败');
        // 降级：直接写入 PTY
        this.pty.write(userMessage + '\r');
      }
    } else {
      // 非智能模式：直接写入 PTY
      this.pty.write(userMessage + '\r');
    }
  }

  /**
   * 处理活跃模式下的消息（Claude 启动后）
   * @param {string} userMessage - 用户消息
   */
  async handleActiveMessage(userMessage) {
    // 先刷新之前的缓冲区内容，让用户看到之前的输出
    if (this.outputBuffer.pending) {
      logger.info('用户发送消息，刷新输出缓冲区');
      this.channel.flushBuffer();
    }

    // 临时关闭静默模式 30 秒，让用户能看到 Claude 的响应
    this.channel.setSilentMode(false);

    // 清除之前的定时器
    if (this._silentTimer) {
      clearTimeout(this._silentTimer);
    }

    // 30 秒后恢复静默模式
    this._silentTimer = setTimeout(() => {
      this.channel.setSilentMode(true);
      logger.info('静默模式已恢复');
    }, 30000);

    // 检测是否为交互选择（数字、y/n 等）
    const isInteraction = /^[1-9]\d*$|^y(es)?$|^n(o)?$/i.test(userMessage);

    if (this.smartMode && isInteraction) {
      // 交互选择：使用 LLM 上下文分析
      try {
        const result = await this.llmClient.contextProcess(this.terminalBuffer, userMessage);
        logger.info({ result }, 'LLM 上下文分析结果');

        if (result.action) {
          const arrowCount = result.action.arrowCount || 0;
          const selectionType = result.selectionType || 'number';

          if (selectionType === 'arrow' && arrowCount > 0) {
            let arrowInput = '';
            for (let i = 0; i < arrowCount; i++) {
              arrowInput += '\x1b[B';
            }
            arrowInput += '\r';
            this.pty.write(arrowInput);
          } else if (selectionType === 'arrow' && arrowCount === 0) {
            this.pty.write('\r');
          } else {
            this.pty.write(result.action.value + '\r');
          }
          return;
        }
      } catch (error) {
        logger.error({ error: error.message }, 'LLM 上下文处理失败');
      }
    }

    // 非交互或处理失败：直接透传给 Claude
    this.pty.write(userMessage + '\r');
  }

  /**
   * 使用 LLM 上下文智能处理用户消息
   * @param {string} userMessage - 用户消息
   */
  async handleWithContext(userMessage) {
    try {
      // 先进行意图解析，识别用户想做什么
      const intent = await this.intentParser.parse(userMessage);
      logger.info({ intent }, '意图解析结果');

      // 如果是 Claude 命令、Shell 命令或内置命令，直接执行
      if (intent.type === IntentTypes.CLAUDE_COMMAND) {
        this.executeClaudeCommand(intent.command, intent.params);
        return;
      }

      if (intent.type === IntentTypes.SHELL_COMMAND) {
        logger.info({ command: intent.command }, '执行 shell 命令');
        this.channel.send(`🔧 执行命令: ${intent.command}`);
        this.pty.write(intent.command + '\r');
        return;
      }

      if (intent.type === IntentTypes.BUILT_IN) {
        this.handleCommand(`${intent.command}${intent.params.path ? ' ' + intent.params.path : ''}`);
        return;
      }

      // 对于对话交互（选择、确认等），使用上下文分析
      // 调用 LLM 进行上下文分析
      const result = await this.llmClient.contextProcess(this.terminalBuffer, userMessage);
      logger.info({ result }, 'LLM 上下文分析结果');

      // 根据分析结果处理
      if (result.action) {
        const arrowCount = result.action.arrowCount || 0;
        const selectionType = result.selectionType || 'number';

        logger.info({
          value: result.action.value,
          type: result.action.type,
          selectionType,
          arrowCount
        }, '🎯 准备执行用户选择');

        if (selectionType === 'arrow' && arrowCount > 0) {
          // 方向键选择：先按方向键，再回车
          let arrowInput = '';
          for (let i = 0; i < arrowCount; i++) {
            arrowInput += '\x1b[B'; // 下箭头
          }
          arrowInput += '\r'; // 回车确认
          this.pty.write(arrowInput);
          logger.info({ arrowCount }, '✅ 已发送方向键+回车');
        } else if (selectionType === 'arrow' && arrowCount === 0) {
          // 选择默认选项：直接回车
          this.pty.write('\r');
          logger.info('✅ 已发送回车（选择默认选项）');
        } else {
          // 数字选择或确认：直接输入值
          this.pty.write(result.action.value + '\r');
          logger.info({ value: result.action.value }, '✅ 已写入终端');
        }
      } else {
        // 没有明确的 action，直接写入终端
        this.pty.write(userMessage + '\r');
      }
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 上下文处理失败');
      // 降级：直接写入终端
      this.pty.write(userMessage + '\r');
    }
  }

  /**
   * 使用意图解析处理用户消息（降级方案）
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
      // 判断是纯启动命令还是带任务的命令
      const isStartOnly = ['开始对话', '启动', '开始', 'start'].includes(command.trim());

      let claudeCmd;
      if (isStartOnly) {
        // 纯启动命令，直接执行 claude
        claudeCmd = 'claude';
        this.channel.send(`🚀 启动 Claude Code`);
      } else {
        // 带任务的命令，传入任务描述
        const escaped = command.replace(/'/g, "'\\''");
        claudeCmd = `claude '${escaped}'`;
        this.channel.send(`🚀 启动 Claude Code: ${command}`);
      }

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
      // 清除等待选择状态（如果有）
      if (this.waitingForSelection) {
        this.waitingForSelection = false;
        session.clearSelection();
        this.selectionDetector.clearLastSelection();
        logger.debug('confirm 处理完成，清除等待选择状态');
      }
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
      case '/status':
        this.handleStatus();
        break;
      default:
        this.channel.send(`未知命令: ${cmd}\n可用命令: /cd, /ls, /restart, /status`);
    }
  }

  /**
   * 处理 /status 命令
   */
  handleStatus() {
    const session = this.intentParser.getSession();

    let msg = '📊 当前状态\n\n';
    msg += `会话模式: ${session.mode === 'claude_active' ? 'Claude 活跃' : '空闲'}\n`;
    msg += `任务状态: ${this.taskStatus.isRunning ? '运行中' : '空闲'}\n`;

    if (this.taskStatus.isRunning && this.taskStatus.startTime) {
      const elapsed = Math.floor((Date.now() - this.taskStatus.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      msg += `运行时间: ${minutes}分${seconds}秒\n`;
    }

    msg += `任务阶段: ${this.taskStatus.phase}\n`;
    msg += `静默模式: ${this.channel.silentMode ? '是' : '否'}\n`;

    // 显示缓冲区状态
    if (this.outputBuffer.pending) {
      const previewLength = 500;
      const preview = this.outputBuffer.pending.length > previewLength
        ? this.outputBuffer.pending.slice(-previewLength)
        : this.outputBuffer.pending;
      msg += `\n📝 待发送输出 (最近 ${preview.length} 字符):\n`;
      msg += '─'.repeat(20) + '\n';
      msg += preview;
    } else {
      msg += '\n📝 待发送输出: (空)';
    }

    // 立即发送状态信息
    this.channel.sendImmediate(msg);

    // 同时刷新缓冲区内容
    this.channel.flushBuffer();
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
