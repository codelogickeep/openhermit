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
    this.llmClient = getLLMClient();
    this.interactionAnalyzer = getInteractionAnalyzer();
    this.interactionContext = getInteractionContext();
    this.smartMode = !!getDashScopeApiKey(); // 智能模式：是否启用了 LLM

    // 终端输出缓冲区（用于 LLM 上下文分析）
    this.terminalBuffer = '';
    this.maxBufferSize = 5000; // 最大缓冲区大小
    this.lastInteractionBufferEnd = 0; // 上次交互结束时的缓冲区位置

    // 终端输出日志文件
    this.terminalLogFile = null;
    this.terminalLogStream = null;
    this.maxLogFileSize = 5 * 1024 * 1024; // 5MB
    this.terminalLogBuffer = '';  // 日志缓冲区
    this.terminalLogFlushTimer = null;  // 刷新定时器

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
   * 生成带时间戳的日志文件名
   * @returns {string} 日志文件路径
   */
  generateLogFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}-${hour}${minute}${second}`;
    return path.join(process.cwd(), `claude-terminal-${timestamp}.log`);
  }

  /**
   * 初始化终端输出日志文件
   */
  initTerminalLog() {
    try {
      this.terminalLogFile = this.generateLogFileName();
      this.terminalLogStream = fs.createWriteStream(this.terminalLogFile, { flags: 'a' });
      this.terminalLogBuffer = '';

      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      this.terminalLogStream.write(`\n${'═'.repeat(70)}\n`);
      this.terminalLogStream.write(`  OpenHermit 启动 - ${timestamp}\n`);
      this.terminalLogStream.write(`  日志文件: ${this.terminalLogFile}\n`);
      this.terminalLogStream.write(`${'═'.repeat(70)}\n\n`);

      logger.info({ file: this.terminalLogFile }, '📝 终端输出日志文件已创建');
    } catch (error) {
      logger.error({ error: error.message }, '创建终端日志文件失败');
    }
  }

  /**
   * 写入终端输出到日志文件（使用缓冲区）
   * @param {string} data - 终端输出数据
   */
  writeToTerminalLog(data) {
    if (!this.terminalLogStream || !data || !data.trim()) return;

    // 追加到缓冲区
    this.terminalLogBuffer += data;

    // 清除之前的定时器
    if (this.terminalLogFlushTimer) {
      clearTimeout(this.terminalLogFlushTimer);
    }

    // 500ms 后刷新缓冲区，或者缓冲区超过 1000 字符时立即刷新
    if (this.terminalLogBuffer.length >= 1000) {
      this.flushTerminalLog();
    } else {
      this.terminalLogFlushTimer = setTimeout(() => {
        this.flushTerminalLog();
      }, 500);
    }
  }

  /**
   * 刷新终端日志缓冲区
   */
  flushTerminalLog() {
    if (!this.terminalLogStream || !this.terminalLogBuffer.trim()) return;

    try {
      // 检查文件大小，超过限制则轮转
      const stats = fs.statSync(this.terminalLogFile);
      if (stats.size >= this.maxLogFileSize) {
        this.rotateLogFile();
      }

      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      const content = this.terminalLogBuffer;

      this.terminalLogStream.write(`\n${'─'.repeat(70)}\n`);
      this.terminalLogStream.write(`  [${timestamp}]\n`);
      this.terminalLogStream.write(`${'─'.repeat(70)}\n`);
      this.terminalLogStream.write(content);
      this.terminalLogStream.write('\n');

      // 清空缓冲区
      this.terminalLogBuffer = '';
    } catch (error) {
      // 忽略写入错误
    }
  }

  /**
   * 写入缓冲区信息到日志（用于调试）
   * @param {string} bufferData - 缓冲区数据
   */
  writeBufferToLog(bufferData) {
    if (!this.terminalLogStream || !bufferData) return;

    try {
      this.terminalLogStream.write(`\n${'▼'.repeat(35)}\n`);
      this.terminalLogStream.write(`  [缓冲区数据 - 用于 LLM 分析]\n`);
      this.terminalLogStream.write(`${'▼'.repeat(35)}\n`);
      this.terminalLogStream.write(bufferData);
      this.terminalLogStream.write('\n');
    } catch (error) {
      // 忽略写入错误
    }
  }

  /**
   * 轮转日志文件
   */
  rotateLogFile() {
    // 先刷新缓冲区
    this.flushTerminalLog();
    this.closeTerminalLog();
    this.initTerminalLog();
    logger.info('📝 终端日志文件已轮转');
  }

  /**
   * 关闭终端日志文件
   */
  closeTerminalLog() {
    // 清除定时器
    if (this.terminalLogFlushTimer) {
      clearTimeout(this.terminalLogFlushTimer);
      this.terminalLogFlushTimer = null;
    }

    // 刷新剩余缓冲区
    if (this.terminalLogBuffer) {
      this.flushTerminalLog();
    }

    if (this.terminalLogStream) {
      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      this.terminalLogStream.write(`\n${'═'.repeat(70)}\n`);
      this.terminalLogStream.write(`  OpenHermit 停止 - ${timestamp}\n`);
      this.terminalLogStream.write(`${'═'.repeat(70)}\n`);
      this.terminalLogStream.end();
      this.terminalLogStream = null;
    }
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
    this.initTerminalLog();

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
    this.writeToTerminalLog(cleanData);

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
    this.updateTaskStatus(cleanData);

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
    const isTaskCompleted = this.checkTaskCompletion(cleanData);

    // 更新最后输出时间
    this.lastOutputTime = Date.now();

    // 使用延迟检测机制：等待输出稳定后再触发 LLM 分析
    // 任务完成后不触发，等待用户回复时不触发
    if (!isTaskCompleted && this.smartMode && !this.waitingForUserReply) {
      // 检测是否有等待用户输入的简单特征（作为触发 LLM 分析的条件）
      const hasInputHint = this.hasInputHint(cleanData);

      if (hasInputHint) {
        // 清除之前的定时器
        if (this.interactionCheckTimer) {
          clearTimeout(this.interactionCheckTimer);
        }

        // 设置延迟检测：等待 2 秒没有新输出才触发分析
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
    }

    // 终端输出只缓冲，不主动推送到钉钉
    // 用户可以通过 -status 命令查看
    this.channel.buffer += this.formatter.basicFormat(cleanData);
    if (this.channel.buffer.length > this.channel.maxBufferSize) {
      this.channel.buffer = this.channel.buffer.slice(-this.channel.maxBufferSize);
    }
  }

  /**
   * 检测是否有等待用户输入的简单特征（作为触发 LLM 的条件）
   * @param {string} data - 净化后的数据
   * @returns {boolean} 是否可能需要用户输入
   */
  hasInputHint(data) {
    // 排除正在处理中的状态（思考中、执行中等）
    if (/thinking|actioning|processing|loading/i.test(data)) {
      return false;
    }

    // 检测明确的交互提示特征
    const hints = [
      /\?$/,           // 以问号结尾
      /\(y\/n\)/i,     // y/n 确认
      /\[\d+\/\d+\]/,  // 进度标记 [1/3]
      /^\s*\d+[.)\]]\s+.+/m,  // 编号选项（需要有内容）
    ];

    // 检测提示符，但要确保前面有实际内容
    const hasPrompt = /❯/.test(data);
    const hasContent = data.trim().length > 100;

    return hints.some(h => h.test(data)) || (hasPrompt && hasContent);
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
      this.writeBufferToLog(newOutput);

      // 使用 LLM 分析
      const analysis = await this.interactionAnalyzer.analyze(newOutput);

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
      // 清除状态行，避免 ANSI 转义序列残留
      process.stdout.write('\r\x1b[K\n');
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

    // 检测 ESC 指令：终止 Claude Code 当前任务
    if (trimmed.toLowerCase() === 'esc' || trimmed === '\x1b' || trimmed === 'escape') {
      this.handleEscCommand();
      return;
    }

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
      this.channel.send('⚠️ 当前有待审批的操作，请先回复 y(同意) 或 n(拒绝)', { immediate: true });
      return;
    }

    // OpenHermit 系统命令（- 前缀）
    if (trimmed.startsWith('-')) {
      this.handleSystemCommand(trimmed);
      return;
    }

    // Bash 命令（! 前缀）- 在工作目录中执行
    if (trimmed.startsWith('!')) {
      this.handleBashCommand(trimmed.slice(1).trim());
      return;
    }

    // 其他所有内容：转发给 Claude 终端
    const session = this.intentParser.getSession();
    if (session.mode === 'claude_active') {
      // 检测 /exit 命令：退出 Claude Code 后需要清理缓冲区
      const isExitCommand = trimmed === '/exit' || trimmed.toLowerCase() === 'exit';

      // 检查是否有交互上下文（非标准交互）
      if (this.interactionContext.hasContext() && this.smartMode) {
        // 有上下文，用 LLM 解析用户回复
        this.handleContextualReply(trimmed);
      } else {
        // 无上下文，直接写入
        this.writeCommand(trimmed);
      }

      // 如果是退出命令，清理缓冲区和重置状态
      if (isExitCommand) {
        this.clearClaudeSession();
      }
    } else {
      // Claude 未启动：提示错误
      this.channel.send(`⚠️ Claude 终端未启动\n\n使用 \`-claude\` 启动，或发送 \`-help\` 查看帮助`, { immediate: true });
    }
  }

  /**
   * 处理带上下文的用户回复
   * @param {string} userReply - 用户回复
   */
  async handleContextualReply(userReply) {
    try {
      logger.info('🤖 解析带上下文的用户回复');

      // 重置等待状态
      this.waitingForUserReply = false;

      // 用 LLM 解析
      const result = await this.interactionAnalyzer.parseUserReply(userReply);

      // 清除上下文
      this.interactionContext.clearContext();

      // 清理缓冲区：移除本次交互之前的内容，只保留最新内容
      // 这样下次分析时就不会包含旧的交互选项
      if (this.lastInteractionBufferEnd > 0 && this.terminalBuffer.length > this.lastInteractionBufferEnd) {
        this.terminalBuffer = this.terminalBuffer.slice(this.lastInteractionBufferEnd);
        logger.debug({ removedLength: this.lastInteractionBufferEnd }, '🧹 清理交互前的缓冲区内容');
      } else if (this.lastInteractionBufferEnd > 0) {
        // 如果缓冲区已经被更新但位置不对，清空缓冲区
        this.terminalBuffer = '';
      }
      this.lastInteractionBufferEnd = 0;
      this.lastAnalyzedPosition = 0;  // 重置分析位置

      // 发送解析结果到 PTY
      if (result.understood && result.input) {
        logger.info({ input: result.input }, '✅ LLM 解析用户回复成功');
        this.writeCommand(result.input);

        // 可选：给用户反馈
        if (result.feedback) {
          this.channel.send(`💡 ${result.feedback}`, { immediate: true });
        }
      } else {
        // 无法理解，直接发送原始输入
        logger.warn('LLM 无法理解用户回复，使用原始输入');
        this.writeCommand(userReply);
      }
    } catch (error) {
      logger.error({ error: error.message }, '解析用户回复失败');
      // 降级：直接发送原始输入
      this.waitingForUserReply = false;
      this.interactionContext.clearContext();
      // 清理缓冲区
      if (this.lastInteractionBufferEnd > 0) {
        this.terminalBuffer = this.terminalBuffer.slice(this.lastInteractionBufferEnd);
      }
      this.lastInteractionBufferEnd = 0;
      this.lastAnalyzedPosition = 0;
      this.writeCommand(userReply);
    }
  }

  /**
   * 处理 Bash 命令（! 前缀）
   * @param {string} command - 要执行的命令
   */
  handleBashCommand(command) {
    if (!command) {
      this.channel.send('用法: `!<命令>` - 在工作目录中执行 bash 命令', { immediate: true });
      return;
    }

    const { exec } = require('child_process');
    const workingDir = this.pty.getWorkingDir();

    logger.info({ command, workingDir }, '执行 Bash 命令');

    exec(command, { cwd: workingDir, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        this.channel.send(`❌ 命令执行失败:\n\`\`\`\n${error.message}\n\`\`\``, { immediate: true });
        return;
      }

      let result = '';
      if (stdout) {
        result += stdout;
      }
      if (stderr) {
        result += `\n[stderr]\n${stderr}`;
      }

      if (!result.trim()) {
        result = '(命令执行成功，无输出)';
      }

      // 限制输出长度
      if (result.length > 3000) {
        result = result.slice(0, 3000) + '\n... (输出已截断)';
      }

      this.channel.send(`## 💻 命令结果\n\n\`\`\`bash\n$ ${command}\n\`\`\`\n\n\`\`\`\n${result}\n\`\`\``, { immediate: true });
    });
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
          // 不推送执行确认，直接执行
          this.writeCommand(intent.command);
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
        this.writeCommand(userMessage);
      }
    } else {
      // 非智能模式：直接写入 PTY
      this.writeCommand(userMessage);
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

    // 从中文选择中提取数字（如"选择2"、"第二个"等）
    const chineseNumberMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '第一个': 1, '第二个': 2, '第三个': 3 };
    let extractedNumber = null;

    // 尝试从消息中提取数字
    const numMatch = userMessage.match(/(\d+)/);
    if (numMatch) {
      extractedNumber = parseInt(numMatch[1]);
    } else {
      // 检查中文数字
      for (const [key, value] of Object.entries(chineseNumberMap)) {
        if (userMessage.includes(key)) {
          extractedNumber = value;
          break;
        }
      }
    }

    if (this.smartMode && (isInteraction || extractedNumber)) {
      // 交互选择：使用 LLM 上下文分析
      try {
        const inputForAnalysis = extractedNumber ? String(extractedNumber) : userMessage;
        const result = await this.llmClient.contextProcess(this.terminalBuffer, inputForAnalysis);
        logger.info({ result, extractedNumber }, 'LLM 上下文分析结果');

        if (result.action) {
          const selectionType = result.selectionType || 'number';

          if (selectionType === 'arrow') {
            // 方向键选择模式
            let arrowCount = result.action.arrowCount || 0;

            // 如果 LLM 没有返回 arrowCount，但用户指定了选项号，计算需要按几次方向键
            if (arrowCount === 0 && extractedNumber && extractedNumber > 1) {
              // 假设默认选中第一个选项，需要按 (N-1) 次下箭头
              arrowCount = extractedNumber - 1;
            }

            logger.info({ selectionType, arrowCount, targetOption: extractedNumber }, '🎮 方向键选择模式');

            let input = '';
            for (let i = 0; i < arrowCount; i++) {
              input += '\x1b[B';  // 下箭头
            }
            input += '\r';  // 回车确认

            logger.info({ input: input.replace(/\x1b/g, '\\e').replace(/\r/g, '\\r') }, '⌨️ 发送方向键序列');
            this.pty.write(input);
          } else if (selectionType === 'number') {
            // 数字选择模式：直接发送数字
            const valueToSend = extractedNumber || result.action.value;
            logger.info({ value: valueToSend }, '📤 数字选择模式');
            this.pty.write(String(valueToSend));
            setTimeout(() => {
              this.pty.write('\r');
            }, 50);
          } else if (selectionType === 'confirm') {
            // y/n 确认模式
            const valueToSend = result.action.value || (extractedNumber === 1 ? 'y' : 'n');
            logger.info({ value: valueToSend }, '✅ 确认模式');
            this.pty.write(valueToSend);
            setTimeout(() => {
              this.pty.write('\r');
            }, 50);
          } else {
            // 其他：直接发送
            const valueToSend = result.action.value || (extractedNumber ? String(extractedNumber) : userMessage);
            this.pty.write(valueToSend);
            setTimeout(() => {
              this.pty.write('\r');
            }, 50);
          }
          return;
        }
      } catch (error) {
        logger.error({ error: error.message }, 'LLM 上下文处理失败');
      }
    }

    // 非交互或处理失败：直接透传给 Claude
    logger.info({ message: userMessage }, '📤 发送消息到 Claude 终端');
    this.pty.write(userMessage);
    // 延迟发送回车，确保文本先被接收
    setTimeout(() => {
      this.pty.write('\r');
    }, 100);
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
        this.writeCommand(intent.command);
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
          this.writeCommand(result.action.value);
          logger.info({ value: result.action.value }, '✅ 已写入终端');
        }
      } else {
        // 没有明确的 action，直接写入终端
        this.writeCommand(userMessage);
      }
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 上下文处理失败');
      // 降级：直接写入终端
      this.writeCommand(userMessage);
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
          this.writeCommand(intent.command);
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
          this.writeCommand(userMessage);
      }
    } catch (error) {
      logger.error({ error: error.message }, '意图解析失败');
      // 降级：直接写入 PTY
      this.writeCommand(userMessage);
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
      } else {
        // 带任务的命令，传入任务描述
        const escaped = command.replace(/'/g, "'\\''");
        claudeCmd = `claude '${escaped}'`;
      }

      this.writeCommand(claudeCmd);
      session.setMode('claude_active');
    } else {
      // 已在 Claude 会话中，直接发送消息
      this.writeCommand(command);
    }
  }

  /**
   * 处理对话交互
   * @param {object} intent - 意图对象
   */
  async handleConversation(intent) {
    // 所有交互都通过 LLM 处理，这里只做简单的命令转发
    if (intent.command === 'confirm') {
      // y/n 确认
      this.writeCommand(intent.params.value);
      return;
    }

    if (intent.command === 'select') {
      // 选择：直接发送选择值
      const choice = intent.params.choice;
      this.pty.write((typeof choice === 'string' ? choice : String(choice)) + '\r');
      return;
    }

    // 其他对话：直接发送
    this.writeCommand(intent.command);
  }

  /**
   * 处理系统命令（- 前缀）
   * @param {string} command - 命令
   */
  handleSystemCommand(command) {
    const parts = command.slice(1).trim().split(/\s+/); // 移除 - 前缀
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'cd':
        this.handleCd(args);
        break;
      case 'ls':
        this.handleLs();
        break;
      case 'claude':
        this.handleClaude(args);
        break;
      case 'status':
        this.handleStatus();
        break;
      case 'help':
        this.handleHelp();
        break;
      default:
        this.channel.send(`❌ 未知命令: \`-${cmd}\`\n\n使用 \`-help\` 查看可用命令。`, { immediate: true });
    }
  }

  /**
   * 处理 -help 命令
   */
  handleHelp() {
    const msg = `## 📖 OpenHermit 帮助

### 📂 目录管理
| 命令 | 说明 |
|------|------|
| \`-cd <目录>\` | 切换工作目录 |
| \`-ls\` | 查看可选目录 |

### 🚀 系统命令
| 命令 | 说明 |
|------|------|
| \`-claude [任务]\` | 启动 Claude Code |
| \`-status\` | 查看执行状态 |
| \`-help\` | 查看帮助 |

### 💻 Bash 命令
| 命令 | 说明 |
|------|------|
| \`!<命令>\` | 在工作目录执行 bash 命令 |

### ⌨️ 快捷指令
| 指令 | 说明 |
|------|------|
| \`esc\` | 终止 Claude Code 当前任务（发送两次 ESC） |

### 💡 使用说明
- 带 \`-\` 前缀的命令由 OpenHermit 处理
- 带 \`!\` 前缀的命令在工作目录执行 bash
- 发送 \`esc\` 可终止 Claude Code 当前任务
- 其他所有内容直接发送给 Claude 终端`;

    this.channel.send(msg, { immediate: true });
  }

  /**
   * 处理 -cd 命令
   * @param {string} path - 目标路径
   */
  handleCd(path) {
    if (!path) {
      this.channel.send('用法: `-cd <目录路径>`', { immediate: true });
      return;
    }

    // 处理相对路径
    let targetPath = path;
    if (!path.startsWith('/')) {
      targetPath = `${this.pty.getWorkingDir()}/${path}`;
    }

    const success = this.pty.setWorkingDir(targetPath);

    if (success) {
      this.channel.send(`✅ 已切换到: \`${this.pty.getWorkingDir()}\``, { immediate: true });
    } else {
      const rootDir = getAllowedRootDir();
      this.channel.send(`❌ 切换失败: 仅允许在 \`${rootDir}\` 下操作`, { immediate: true });
    }
  }

  /**
   * 处理 -ls 命令
   */
  handleLs() {
    this.channel.sendDirList(this.pty.getWorkingDir());
  }

  /**
   * 处理 -claude 命令 - 直接启动 Claude
   * @param {string} args - 可选的任务描述
   */
  handleClaude(args) {
    const session = this.intentParser.getSession();

    if (session.mode === 'claude_active') {
      this.channel.send('⚠️ Claude 已在运行中，直接发送消息即可', { immediate: true });
      return;
    }

    // 启动 Claude（直接写入命令和回车，不使用延迟）
    if (args) {
      // 带任务描述
      const escaped = args.replace(/'/g, "'\\''");
      this.pty.write(`claude '${escaped}'\r`);
      this.channel.send(`🚀 启动 Claude Code: ${args}`, { immediate: true });
    } else {
      // 纯启动
      this.pty.write('claude\r');
      this.channel.send('🚀 启动 Claude Code', { immediate: true });
    }

    session.setMode('claude_active');
  }

  /**
   * 处理 -status 命令 - 查看系统状态
   */
  async handleStatus() {
    const session = this.intentParser.getSession();

    let msg = '## 📊 系统状态\n\n';
    msg += `| 项目 | 状态 |\n|------|------|\n`;
    msg += `| 会话模式 | ${session.mode === 'claude_active' ? '🟢 Claude 活跃' : '⚪ 空闲'} |\n`;
    msg += `| 任务状态 | ${this.taskStatus.isRunning ? '🔄 运行中' : '⚪ 空闲'} |\n`;
    msg += `| 静默模式 | ${this.channel.silentMode ? '是' : '否'} |\n`;

    if (this.taskStatus.isRunning && this.taskStatus.startTime) {
      const elapsed = Math.floor((Date.now() - this.taskStatus.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      msg += `| 运行时间 | ${minutes}分${seconds}秒 |\n`;
    }

    msg += `\n**当前目录:** \`${this.pty.getWorkingDir()}\``;

    // 使用 LLM 总结最近输出（使用完整的终端缓冲区）
    if (this.terminalBuffer && this.terminalBuffer.trim().length > 50) {
      msg += '\n\n### 📝 最近输出\n';

      if (this.smartMode) {
        try {
          // 使用 LLM 总结
          const summary = await this.llmClient.summarizeStatus(this.terminalBuffer);
          msg += summary;
        } catch (error) {
          // 降级：显示原始输出的最后部分
          msg += this.getFallbackStatusOutput();
        }
      } else {
        // 非智能模式：显示原始输出
        msg += this.getFallbackStatusOutput();
      }
    }

    // 立即发送状态信息
    this.channel.sendImmediate(msg);
  }

  /**
   * 获取降级的最近输出（用于 -status 命令）
   * @returns {string} 格式化的输出
   */
  getFallbackStatusOutput() {
    if (!this.terminalBuffer || this.terminalBuffer.trim().length < 20) {
      return '暂无有效输出';
    }

    // 清理并截取最后 200 字符
    let cleaned = this.terminalBuffer
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (cleaned.length > 200) {
      cleaned = '...' + cleaned.slice(-200);
    }

    return `\`\`\`\n${cleaned}\n\`\`\``;
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
    this.writeCommand('y');

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
    this.writeCommand('n');

    // 清空缓冲区
    this.pausedBuffer = '';
  }

  /**
   * 处理 ESC 指令：终止 Claude Code 当前任务
   * 发送两次 ESC 键来中断当前操作
   */
  handleEscCommand() {
    const session = this.intentParser.getSession();

    if (session.mode !== 'claude_active') {
      this.channel.send('⚠️ Claude 未启动，无需终止', { immediate: true });
      return;
    }

    // 发送两次 ESC 键（\x1b）来终止 Claude Code 的当前任务
    logger.info('🛑 收到 ESC 指令，发送两次 ESC 键终止当前任务');

    // 发送第一次 ESC
    this.pty.write('\x1b');

    // 短暂延迟后发送第二次 ESC
    setTimeout(() => {
      this.pty.write('\x1b');
      logger.info('✅ 已发送两次 ESC 键');
    }, 100);

    // 发送反馈消息
    this.channel.send('🛑 已发送终止指令（ESC x2）', { immediate: true });

    // 重置相关状态
    this.waitingForUserReply = false;
    this.interactionContext.clearContext();
    this.lastInteractionBufferEnd = 0;
    this.lastAnalyzedPosition = 0;
  }

  /**
   * 清理 Claude 会话状态和缓冲区
   * 在 /exit 或 Claude 退出后调用
   */
  clearClaudeSession() {
    logger.info('🧹 清理 Claude 会话状态和缓冲区');

    // 重置会话模式
    const session = this.intentParser.getSession();
    session.setMode('idle');

    // 清理终端缓冲区
    this.terminalBuffer = '';
    this.outputBuffer.pending = '';

    // 清理钉钉通道缓冲区
    this.channel.buffer = '';

    // 重置交互状态
    this.waitingForUserReply = false;
    this.interactionContext.clearContext();
    this.lastInteractionBufferEnd = 0;
    this.lastAnalyzedPosition = 0;

    // 重置任务状态
    this.taskStatus = {
      isRunning: false,
      startTime: null,
      phase: 'idle'
    };

    // 重置 HITL 状态
    this.hitlActive = false;
    this.pausedBuffer = '';

    logger.info('✅ Claude 会话已清理');
  }

  /**
   * 停止应用
   */
  stop() {
    logger.info('停止 OpenHermit...');
    this.closeTerminalLog();
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
