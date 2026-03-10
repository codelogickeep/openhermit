#!/usr/bin/env node

import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
const { getLLMClient, getInteractionAnalyzer, getInteractionContext } = await import('./llm/index.js');

// 导入核心模块
const { TerminalLogger, TaskManager, SystemCommands, HitlController, MessageHandler, IPCServer, getIPCServer, HookHandler, getHookHandler, InteractionState } = await import('./core/index.js');

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
    // 核心组件
    this.pty = new PTYEngine();
    this.channel = new DingTalkChannel();
    this.intentParser = getIntentParser();
    this.formatter = getMarkdownFormatter();
    this.llmClient = getLLMClient();
    this.interactionAnalyzer = getInteractionAnalyzer();
    this.interactionContext = getInteractionContext();
    this.smartMode = !!getDashScopeApiKey(); // 智能模式：是否启用了 LLM

    // 子模块实例
    this.terminalLogger = new TerminalLogger();
    this.taskManager = new TaskManager();
    this.systemCommands = new SystemCommands();
    this.hitlController = new HitlController();
    this.messageHandler = new MessageHandler();

    // Hook 系统
    this.ipcServer = getIPCServer();
    this.hookHandler = getHookHandler();

    // HITL 状态
    this.hitlActive = false;
    this.pausedBuffer = '';

    // 安全确认状态
    this.securityPendingCommand = null;
    this.securityPendingCallback = null;

    // 终端输出缓冲区（用于 LLM 上下文分析）
    this.terminalBuffer = '';
    this.maxBufferSize = 5000; // 最大缓冲区大小
    this.lastInteractionBufferEnd = 0; // 上次交互结束时的缓冲区位置

    // PTY 输出处理队列
    this.ptyQueue = [];
    this.isProcessingPty = false;

    // 输出缓冲（静默模式）
    this.outputBuffer = {
      silent: true,  // 静默模式（不实时发送）
      pending: '',
      maxSize: 10000  // 最大缓冲区大小
    };

    // 选项检测相关
    this.lastSentOptionsKey = null;  // 上次发送的选项的 JSON key（避免重复发送）

    // LLM 分析状态追踪
    this.lastAnalyzedPosition = 0;  // 上次分析时的缓冲区位置
    this.waitingForUserReply = false;  // 是否正在等待用户回复

    // 延迟检测机制
    this.interactionCheckTimer = null;  // 交互检测定时器
    this.interactionCheckDelay = 2000;  // 延迟检测时间（毫秒）
    this.lastOutputTime = 0;  // 最后一次输出时间

    if (this.smartMode) {
      logger.info('智能交互模式已启用');
    }
  }

  /**
   * 获取上下文对象（用于子模块调用）
   * @returns {object}
   */
  getContext() {
    return {
      // 核心组件
      pty: this.pty,
      channel: this.channel,
      intentParser: this.intentParser,
      interactionAnalyzer: this.interactionAnalyzer,
      interactionContext: this.interactionContext,
      llmClient: this.llmClient,
      terminalBuffer: this.terminalBuffer,
      outputBuffer: this.outputBuffer,
      formatter: this.formatter,

      // 状态
      hitlActive: this.hitlActive,
      pausedBuffer: this.pausedBuffer,
      waitingForUserReply: this.waitingForUserReply,
      smartMode: this.smartMode,
      lastInteractionBufferEnd: this.lastInteractionBufferEnd,
      lastAnalyzedPosition: this.lastAnalyzedPosition,
      lastOutputTime: this.lastOutputTime,

      // 安全确认状态
      securityPendingCommand: this.securityPendingCommand,
      securityPendingCallback: this.securityPendingCallback,

      // 任务状态（兼容旧代码）
      taskStatus: this.taskManager.status,

      // 子模块
      taskManager: this.taskManager,
      terminalLogger: this.terminalLogger,
      systemCommands: this.systemCommands,
      hitlController: this.hitlController,

      // app 引用（用于安全确认执行）
      app: this,

      // 方法绑定
      writeCommand: this.writeCommand.bind(this),
      getAllowedRootDir: getAllowedRootDir,

      // 清理会话方法
      clearClaudeSession: (ctx) => {
        this.hitlController.clearClaudeSession(ctx || this.getContext());
      },

      // 内部定时器引用（用于活跃消息处理）
      _silentTimer: this._silentTimer,
    };
  }

  /**
   * 写入命令到 PTY（延后写入回车）
   * @param {string} command - 要写入的命令
   * @param {number} delay - 延迟时间（毫秒），默认 150ms
   */
  writeCommand(command, delay = 150) {
    // 先写入命令文本
    this.pty.write(command);
    // 延迟后写入回车
    setTimeout(() => {
      this.pty.write('\r');
    }, delay);
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
   * 初始化 Hook 系统
   * 启动 IPC Server 并注册事件处理
   */
  async initHookSystem() {
    logger.info('正在初始化 Hook 系统...');

    // 设置 Hook Handler 回调
    this.hookHandler.setCallbacks({
      onStateChange: (newState, oldState) => {
        logger.info({ from: oldState, to: newState }, 'Hook 状态变更');
        // 更新任务状态
        if (newState === InteractionState.RUNNING) {
          this.taskManager.status.isRunning = true;
          this.taskManager.status.phase = 'executing';
        } else if (newState === InteractionState.COMPLETED) {
          this.taskManager.status.isRunning = false;
          this.taskManager.status.phase = 'completed';
        } else if (newState === InteractionState.WAITING_CONFIRM || newState === InteractionState.WAITING_INPUT) {
          this.taskManager.status.phase = 'waiting';
        }
      },
      onSendMessage: (msgData) => {
        // 发送 Hook 事件消息到钉钉
        logger.info({ type: msgData.type }, '📤 Hook 消息发送到钉钉');
        this.channel.send(msgData.message, { immediate: true });

        // 如果是完成消息，重置状态
        if (msgData.type === 'completed') {
          this.taskManager.reset();
        }
      }
    });

    // 注册 IPC 事件处理
    this.ipcServer.on('pre-tool', (data) => this.hookHandler.handlePreToolUse(data));
    this.ipcServer.on('notification', (data) => this.hookHandler.handleNotification(data));
    this.ipcServer.on('stop', (data) => this.hookHandler.handleStop(data));

    // 启动 IPC Server
    try {
      await this.ipcServer.start();
      logger.info({ port: this.ipcServer.port }, '🔒 Hook IPC Server 已启动');
    } catch (error) {
      logger.error({ error: error.message }, 'IPC Server 启动失败');
      // 不阻止应用启动，Hook 系统是可选的
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

    // 初始化终端日志文件
    this.terminalLogger.init();

    // 初始化并测试 LLM 连接（如果配置了 DashScope API Key）
    if (this.smartMode) {
      await this.initLLM();
    } else {
      logger.warn('未配置 DashScope API Key，LLM 分析功能不可用');
    }

    // 设置 PTY 数据监听
    this.pty.onData((data) => {
      this.handlePtyData(data);
    });

    // 设置 PTY 退出监听
    this.pty.onExit(({ exitCode, signal }) => {
      logger.warn({ exitCode, signal }, 'PTY 进程退出');
      // 不主动推送退出通知，用户可通过 -status 查看
    });

    // 设置通道消息监听
    this.channel.on('text', (text, senderId, metadata) => this.handleChannelText(text, senderId, metadata));

    // 设置审批回调监听
    this.channel.on('approve', () => this.handleApprove());
    this.channel.on('reject', () => this.handleReject());

    // 初始化 Hook 系统
    await this.initHookSystem();

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
    // 将数据加入队列进行处理
    this.ptyQueue.push(data);

    // 如果没有在处理，开始处理
    if (!this.isProcessingPty) {
      this.processPtyQueue();
    }
  }

  /**
   * 处理 PTY 输出队列（钉钉通道）
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
      await this.processPtyDataForDingTalk(allData);
    } catch (error) {
      logger.error({ error: error.message }, '处理 PTY 数据失败');
    }

    // 继续处理队列中可能新加入的数据
    await this.processPtyQueue();
  }

  /**
   * 处理 PTY 数据（发送到钉钉通道）
   * 使用净化和防抖机制
   * @param {string} data - PTY 输出
   */
  async processPtyDataForDingTalk(data) {
    // 如果处于 HITL 暂停状态，将数据存入缓冲区
    if (this.hitlActive) {
      this.pausedBuffer += data;
      return;
    }

    // 净化数据（去除 ANSI 码、控制字符、加载动画）
    const cleanData = purify(data);

    if (!cleanData || !cleanData.trim()) return;

    // 写入终端输出日志文件
    this.terminalLogger.write(cleanData);

    // 本地终端输出：显示状态指示器
    this.updateStatusIndicator(cleanData);

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
    this.taskManager.updateStatus(cleanData, this.intentParser.getSession());

    // 检查 HITL（原有的危险命令审批逻辑）
    if (checkHitl(cleanData)) {
      // 暂停输出
      this.hitlActive = true;
      this.pausedBuffer = data;

      // 发送审批提示（HITL 需要用户交互，必须推送）
      const prompt = extractHitlPrompt(cleanData);
      const cardMsg = `\n⚠️ 需要审批\n${prompt || '检测到危险命令，需要您的审批'}\n请回复 'y' 同意 或 'n' 拒绝\n`;
      this.channel.send(cardMsg, { immediate: true });
      return;
    }

    // 检测任务是否完成
    const isTaskCompleted = this.taskManager.checkCompletion(cleanData);

    // 如果任务完成，发送通知
    if (isTaskCompleted) {
      this.channel.send('✅ 任务已完成', { immediate: true });
      logger.info('📤 已发送任务完成通知（规则检测）');
    }

    // 更新最后输出时间
    this.lastOutputTime = Date.now();

    // 超时检测已禁用 - Hook 机制已经提供精确的状态通知
    // 如果需要重新启用，取消下面的注释
    // this.taskManager.resetCompletionCheckTimer(
    //   { smartMode: this.smartMode, waitingForUserReply: this.waitingForUserReply },
    //   () => this.checkCompletionByLLM()
    // );

    // 使用延迟检测机制：等待输出稳定后再触发 LLM 分析
    // 任务完成后不触发，等待用户回复时不触发
    // 只有 Claude Code 活跃时才触发 LLM 分析（内置命令产生的输出不触发）
    // 所有交互判断都交给 LLM 分析，不再使用规则预判
    const session = this.intentParser.getSession();
    const isClaudeActive = session.mode === 'claude_active';

    if (!isTaskCompleted && this.smartMode && !this.waitingForUserReply && isClaudeActive) {
      // 清除之前的定时器
      if (this.interactionCheckTimer) {
        clearTimeout(this.interactionCheckTimer);
      }

      // 设置延迟检测：等待输出稳定后才触发 LLM 分析
      this.interactionCheckTimer = setTimeout(() => {
        // 检查是否真的没有新输出
        const timeSinceLastOutput = Date.now() - this.lastOutputTime;
        if (timeSinceLastOutput >= this.interactionCheckDelay - 100) {  // 允许 100ms 误差
          // 使用缓冲区位置作为去重 key
          const currentPosition = this.terminalBuffer.length;
          if (currentPosition > this.lastAnalyzedPosition + 50) {
            // 至少有 50 字符的新内容才触发分析
            this.lastAnalyzedPosition = currentPosition;
            logger.info({
              bufferLength: this.terminalBuffer.length,
              timeSinceLastOutput
            }, '🚀 延迟触发 LLM 交互分析');
            // 异步分析，不阻塞
            this.handleLLMInteractionAnalysis(this.terminalBuffer);
          }
        }
        this.interactionCheckTimer = null;
      }, this.interactionCheckDelay);
    }

    // 终端输出只缓冲，不主动推送到钉钉
    // 用户可以通过 -status 命令查看
    this.channel.buffer += this.formatter.basicFormat(cleanData);
    if (this.channel.buffer.length > this.channel.maxBufferSize) {
      this.channel.buffer = this.channel.buffer.slice(-this.channel.maxBufferSize);
    }
  }

  /**
   * 处理 LLM 交互分析（所有交互都用 LLM 分析）
   * @param {string} terminalOutput - 终端输出
   */
  async handleLLMInteractionAnalysis(terminalOutput) {
    try {
      logger.info('🤖 使用 LLM 分析终端输出');

      // 只使用从上次交互结束后的新内容进行分析
      const newOutput = terminalOutput.slice(this.lastInteractionBufferEnd);
      if (!newOutput || newOutput.trim().length < 20) {
        logger.debug('新输出内容太少，跳过分析');
        return;
      }

      // 记录缓冲区数据到日志文件
      this.terminalLogger.writeBuffer(newOutput);

      // 使用 LLM 分析
      const analysis = await this.interactionAnalyzer.analyze(newOutput);

      // 如果 LLM 判断任务已完成
      if (analysis.taskCompleted) {
        this.taskManager.status.phase = 'completed';
        this.taskManager.status.isRunning = false;
        this.channel.send('✅ 任务已完成', { immediate: true });
        logger.info('📤 LLM 判断任务已完成');
        return;
      }

      // 检查是否需要用户交互
      if (!analysis.needsInteraction) {
        logger.debug('LLM 判断不需要用户交互');
        return;
      }

      // 记录当前交互结束时的缓冲区位置
      this.lastInteractionBufferEnd = terminalOutput.length;

      // 保存上下文（只保存新内容）
      const contextId = Date.now().toString();
      this.interactionContext.setContext(contextId, analysis, newOutput);

      // 生成消息
      const message = this.interactionAnalyzer.formatMessage(analysis);

      // 设置等待用户回复状态
      this.waitingForUserReply = true;

      // 发送到钉钉
      this.channel.send(message, { immediate: true, taskCompleted: false });

      // 本地终端显示
      console.log('\n\x1b[33m━━━ 需要您的操作 ━━━\x1b[0m');
      console.log(`  \x1b[36m${analysis.context?.question || '等待输入...'}\x1b[0m`);
      console.log('\x1b[33m━━━━━━━━━━━━━━━━━━━━\x1b[0m\n');

      logger.info({ type: analysis.type, contextId }, '📤 发送 LLM 分析结果到钉钉');
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 交互分析失败');
    }
  }

  /**
   * 超时完成检测
   * 当长时间无输出时调用，使用 LLM 检查是否有遗漏的用户交互
   */
  async checkCompletionByLLM() {
    const analysis = await this.taskManager.checkCompletionByLLM(this.terminalBuffer, this.interactionAnalyzer);

    if (!analysis) {
      return;
    }

    // 如果 LLM 判断任务已完成
    if (analysis.taskCompleted) {
      this.channel.send('✅ 任务已完成', { immediate: true });
      logger.info('📤 超时检测：LLM 判断任务已完成');
      return;
    }

    // 如果需要用户交互
    if (analysis.needsInteraction && !this.waitingForUserReply) {
      // 需要用户确认后续动作，发送提示
      const message = this.interactionAnalyzer.formatMessage(analysis);
      this.waitingForUserReply = true;

      // 记录交互上下文
      const contextId = Date.now().toString();
      this.interactionContext.setContext(contextId, analysis, this.terminalBuffer.slice(-2000));
      this.lastInteractionBufferEnd = this.terminalBuffer.length;

      this.channel.send(message, { immediate: true, taskCompleted: false });
      logger.info({ type: analysis.type }, '📤 超时检测发现需要用户确认后续动作');
    }
  }

  /**
   * 更新状态指示器（本地终端）
   * 只显示简洁的状态信息，不显示原始 PTY 输出
   * @param {string} data - 净化后的数据
   */
  updateStatusIndicator(data) {
    const statusPatterns = [
      { pattern: /thinking/i, text: '⏳ 思考中...' },
      { pattern: /actioning/i, text: '⚡ 执行中...' },
      { pattern: /perambulating/i, text: '🔄 处理中...' },
      { pattern: /initializing/i, text: '🚀 初始化...' },
      { pattern: /processing/i, text: '⏳ 处理中...' },
      { pattern: /loading/i, text: '📥 加载中...' },
    ];

    for (const { pattern, text } of statusPatterns) {
      if (pattern.test(data)) {
        // 清除当前行并输出状态（不使用颜色，避免残留）
        process.stdout.write(`\r${text}`);
        return;
      }
    }
  }

  /**
   * 处理钉钉收到的文本
   * @param {string} text - 文本内容
   * @param {string} senderId - 发送者 ID
   * @param {object} metadata - 消息元数据
   */
  async handleChannelText(text, senderId, metadata = {}) {
    // 确保 text 是字符串
    if (typeof text !== 'string') {
      logger.error({ text, senderId, textType: typeof text }, '❌ handleChannelText 收到非字符串类型的 text');
      return;
    }

    logger.info({ text: text.substring(0, 50), senderId }, '📥 [index.js] handleChannelText 被调用');
    const context = this.getContext();
    await this.messageHandler.handleChannelText(text, senderId, context, metadata);
  }

  /**
   * 处理审批同意
   */
  handleApprove() {
    const context = this.getContext();
    this.hitlController.handleApprove(context);
    // 同步状态
    this.hitlActive = context.hitlActive;
    this.pausedBuffer = context.pausedBuffer;
  }

  /**
   * 处理审批拒绝
   */
  handleReject() {
    const context = this.getContext();
    this.hitlController.handleReject(context);
    // 同步状态
    this.hitlActive = context.hitlActive;
    this.pausedBuffer = context.pausedBuffer;
  }

  /**
   * 停止应用
   */
  stop() {
    logger.info('停止 OpenHermit...');
    this.terminalLogger.close();
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
