import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

// Mock 环境变量
const TEST_ROOT_DIR = '/tmp/openhermit-flow-test';
const TEST_SUB_DIR = path.join(TEST_ROOT_DIR, 'test-project');

beforeEach(async () => {
  process.env.DINGTALK_APP_KEY = 'mock_app_key';
  process.env.DINGTALK_APP_SECRET = 'mock_app_secret';
  process.env.ALLOWED_ROOT_DIR = TEST_ROOT_DIR;
  process.env.DINGTALK_USER_ID = 'test_user_id';

  // 创建测试目录
  if (!fs.existsSync(TEST_ROOT_DIR)) {
    fs.mkdirSync(TEST_ROOT_DIR, { recursive: true });
  }
  if (!fs.existsSync(TEST_SUB_DIR)) {
    fs.mkdirSync(TEST_SUB_DIR, { recursive: true });
  }
});

afterEach(() => {
  // 清理测试目录
  try {
    if (fs.existsSync(TEST_ROOT_DIR)) {
      fs.rmSync(TEST_ROOT_DIR, { recursive: true, force: true });
    }
  } catch (e) {
    // 忽略清理错误
  }
});

/**
 * 模拟 PTY 引擎
 */
class MockPTYEngine extends EventEmitter {
  constructor() {
    super();
    this.workingDir = TEST_ROOT_DIR;
    this.writtenData = [];
    this.isRunning = true;
  }

  start() {
    this.isRunning = true;
  }

  write(data) {
    this.writtenData.push(data);
    this.emit('data', data);
  }

  onData(callback) {
    this.on('data', callback);
  }

  onExit(callback) {
    this.on('exit', callback);
  }

  getWorkingDir() {
    return this.workingDir;
  }

  setWorkingDir(dir) {
    const resolvedPath = path.resolve(this.workingDir, dir);
    // 检查是否在白名单内且目录存在
    if (resolvedPath.startsWith(TEST_ROOT_DIR) && fs.existsSync(resolvedPath)) {
      this.workingDir = resolvedPath;
      return true;
    }
    return false;
  }

  kill() {
    this.isRunning = false;
  }

  // 模拟 PTY 输出
  simulateOutput(text) {
    this.emit('data', text);
  }

  getWrittenData() {
    return this.writtenData.join('');
  }

  clearWrittenData() {
    this.writtenData = [];
  }
}

/**
 * 模拟钉钉通道
 */
class MockDingTalkChannel extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.maxBufferSize = 10000;
    this.connected = false;
    this.mockMode = true;
    this.silentMode = true;
    this.messages = [];
    this.sessionWebhook = 'https://mock.webhook.url';
  }

  async connect() {
    this.connected = true;
    return true;
  }

  send(text, context = {}) {
    // immediate 消息单独存储，不混入 buffer
    if (context.immediate) {
      this.messages.push({ text, context, time: Date.now() });
    } else {
      this.messages.push({ text, context, time: Date.now() });
      this.buffer += text;
    }
  }

  sendImmediate(text) {
    this.messages.push({ text, context: { immediate: true }, time: Date.now() });
  }

  flushBuffer() {
    if (this.buffer) {
      this.messages.push({ text: this.buffer, context: { flush: true }, time: Date.now() });
      this.buffer = '';
    }
  }

  setSilentMode(silent) {
    this.silentMode = silent;
  }

  sendDirList(currentDir) {
    this.messages.push({
      text: `目录列表: ${currentDir}`,
      context: { type: 'dirList' },
      time: Date.now()
    });
  }

  disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  isMockMode() {
    return this.mockMode;
  }

  getLastMessage() {
    return this.messages[this.messages.length - 1];
  }

  clearMessages() {
    this.messages = [];
    this.buffer = '';
  }
}

/**
 * 模拟意图解析器
 */
class MockIntentParser {
  constructor() {
    this.session = {
      mode: 'idle',
      setMode: function(mode) { this.mode = mode; },
      getMode: function() { return this.mode; }
    };
  }

  getSession() {
    return this.session;
  }

  async parse(text) {
    return { type: 'conversation', command: text };
  }
}

/**
 * 模拟交互上下文
 */
class MockInteractionContext {
  constructor() {
    this.hasContextData = false;
  }

  hasContext() {
    return this.hasContextData;
  }

  clearContext() {
    this.hasContextData = false;
  }

  setContext() {
    this.hasContextData = true;
  }
}

/**
 * 模拟 OpenHermit 应用（简化版）
 */
class MockOpenHermit {
  constructor() {
    this.pty = new MockPTYEngine();
    this.channel = new MockDingTalkChannel();
    this.intentParser = new MockIntentParser();
    this.interactionContext = new MockInteractionContext();

    this.terminalBuffer = '';
    this.outputBuffer = { pending: '', maxSize: 10000 };
    this.taskStatus = { isRunning: false, startTime: null, phase: 'idle' };
    this.hitlActive = false;
    this.waitingForUserReply = false;
    this.lastInteractionBufferEnd = 0;
    this.lastAnalyzedPosition = 0;
    this.smartMode = false;
    this.pausedBuffer = '';
  }

  async init() {
    this.pty.start();
    await this.channel.connect();
    return true;
  }

  /**
   * 处理钉钉收到的文本
   */
  async handleChannelText(text) {
    const trimmed = text.trim();

    // 检测 ESC 指令
    if (trimmed.toLowerCase() === 'esc' || trimmed === 'escape') {
      this.handleEscCommand();
      return;
    }

    // OpenHermit 系统命令
    if (trimmed.startsWith('-')) {
      this.handleSystemCommand(trimmed);
      return;
    }

    // 其他内容转发给 Claude 终端
    const session = this.intentParser.getSession();
    if (session.mode === 'claude_active') {
      // 检测 /exit 命令
      const isExitCommand = trimmed === '/exit' || trimmed.toLowerCase() === 'exit';

      this.pty.write(trimmed);
      this.pty.write('\r');

      if (isExitCommand) {
        this.clearClaudeSession();
      }
    } else {
      this.channel.send('⚠️ Claude 终端未启动', { immediate: true });
    }
  }

  /**
   * 处理系统命令
   */
  handleSystemCommand(command) {
    const parts = command.slice(1).trim().split(/\s+/);
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
        this.channel.send(`❌ 未知命令: -${cmd}`, { immediate: true });
    }
  }

  handleCd(path) {
    if (!path) {
      this.channel.send('用法: -cd <目录路径>', { immediate: true });
      return;
    }
    const success = this.pty.setWorkingDir(path);
    if (success) {
      this.channel.send(`✅ 已切换到: ${this.pty.getWorkingDir()}`, { immediate: true });
    } else {
      this.channel.send('❌ 切换失败: 目录不在白名单内', { immediate: true });
    }
  }

  handleLs() {
    const currentDir = this.pty.getWorkingDir();
    let msg = `## 📂 目录列表\n\n**当前工作目录:** ${currentDir}\n`;

    try {
      const items = fs.readdirSync(TEST_ROOT_DIR);
      const dirs = items.filter(item => {
        try {
          return fs.statSync(path.join(TEST_ROOT_DIR, item)).isDirectory();
        } catch { return false; }
      });

      if (dirs.length > 0) {
        msg += '\n### 可选目录\n';
        dirs.forEach(dir => msg += `- ${path.join(TEST_ROOT_DIR, dir)}\n`);
      }
    } catch (error) {
      msg += `\n❌ 无法读取目录: ${error.message}`;
    }

    this.channel.send(msg, { immediate: true });
  }

  handleClaude(args) {
    const session = this.intentParser.getSession();

    if (session.mode === 'claude_active') {
      this.channel.send('⚠️ Claude 已在运行中', { immediate: true });
      return;
    }

    if (args) {
      this.pty.write(`claude '${args}'\r`);
    } else {
      this.pty.write('claude\r');
    }

    session.setMode('claude_active');
    this.taskStatus.isRunning = true;
    this.taskStatus.startTime = Date.now();
    this.taskStatus.phase = 'thinking';

    this.channel.send(args ? `🚀 启动 Claude Code: ${args}` : '🚀 启动 Claude Code', { immediate: true });
  }

  handleStatus() {
    const session = this.intentParser.getSession();

    let msg = '## 📊 系统状态\n\n';
    msg += `| 项目 | 状态 |\n|------|------|\n`;
    msg += `| 会话模式 | ${session.mode === 'claude_active' ? '🟢 Claude 活跃' : '⚪ 空闲'} |\n`;
    msg += `| 任务状态 | ${this.taskStatus.isRunning ? '🔄 运行中' : '⚪ 空闲'} |\n`;
    msg += `| 静默模式 | ${this.channel.silentMode ? '是' : '否'} |\n`;
    msg += `\n**当前目录:** ${this.pty.getWorkingDir()}`;

    this.channel.sendImmediate(msg);
    this.channel.flushBuffer();
  }

  handleHelp() {
    this.channel.send('## 📖 OpenHermit 帮助\n\n命令: -cd, -ls, -claude, -status, -help\n\n快捷指令: esc (终止当前任务)', { immediate: true });
  }

  handleEscCommand() {
    const session = this.intentParser.getSession();

    if (session.mode !== 'claude_active') {
      this.channel.send('⚠️ Claude 未启动，无需终止', { immediate: true });
      return;
    }

    // 发送两次 ESC
    this.pty.write('\x1b');
    this.pty.write('\x1b');

    this.channel.send('🛑 已发送终止指令（ESC x2）', { immediate: true });

    // 重置相关状态
    this.waitingForUserReply = false;
    this.interactionContext.clearContext();
    this.lastInteractionBufferEnd = 0;
    this.lastAnalyzedPosition = 0;
  }

  clearClaudeSession() {
    const session = this.intentParser.getSession();
    session.setMode('idle');

    this.terminalBuffer = '';
    this.outputBuffer.pending = '';
    this.channel.buffer = '';

    this.waitingForUserReply = false;
    this.interactionContext.clearContext();
    this.lastInteractionBufferEnd = 0;
    this.lastAnalyzedPosition = 0;

    this.taskStatus = { isRunning: false, startTime: null, phase: 'idle' };
    this.hitlActive = false;
    this.pausedBuffer = '';
  }

  stop() {
    this.pty.kill();
    this.channel.disconnect();
  }
}

describe('用户流程集成测试', () => {
  let app;

  beforeEach(async () => {
    app = new MockOpenHermit();
    await app.init();
  });

  afterEach(() => {
    app.stop();
  });

  describe('完整用户流程', () => {
    it('应该按顺序执行完整流程: -ls -> -cd -> -claude -> -status -> 自然语言 -> esc -> /exit -> -status', async () => {
      const messages = app.channel.messages;

      // Step 1: 发送 -ls 查看目录
      console.log('\n📍 Step 1: 发送 -ls');
      await app.handleChannelText('-ls');

      let lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('目录列表');
      expect(lastMsg.text).toContain(TEST_ROOT_DIR);
      console.log('✅ -ls 命令成功，返回目录列表');

      // Step 2: 发送 -cd 切换目录
      console.log('\n📍 Step 2: 发送 -cd ./test-project');
      await app.handleChannelText('-cd ./test-project');

      lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('已切换到');
      expect(app.pty.getWorkingDir()).toBe(TEST_SUB_DIR);
      console.log('✅ -cd 命令成功，当前目录:', app.pty.getWorkingDir());

      // Step 3: 发送 -claude 启动 Claude
      console.log('\n📍 Step 3: 发送 -claude');
      await app.handleChannelText('-claude');

      lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('启动 Claude Code');
      expect(app.intentParser.getSession().mode).toBe('claude_active');
      expect(app.taskStatus.isRunning).toBe(true);
      console.log('✅ -claude 命令成功，Claude 已启动');

      // Step 4: 发送 -status 查看状态
      console.log('\n📍 Step 4: 发送 -status');
      await app.handleChannelText('-status');

      lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('系统状态');
      expect(lastMsg.text).toContain('Claude 活跃');
      expect(lastMsg.text).toContain('运行中');
      console.log('✅ -status 命令成功，显示 Claude 活跃状态');

      // Step 5: 发送自然语言指令给 Claude
      console.log('\n📍 Step 5: 发送自然语言指令 "帮我分析代码"');
      await app.handleChannelText('帮我分析代码');

      expect(app.pty.getWrittenData()).toContain('帮我分析代码');
      console.log('✅ 自然语言指令已发送到 PTY');

      // 清空 PTY 写入记录
      app.pty.clearWrittenData();

      // Step 6: 发送 esc 终止当前任务
      console.log('\n📍 Step 6: 发送 esc');
      await app.handleChannelText('esc');

      lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('终止指令');
      expect(app.pty.getWrittenData()).toContain('\x1b');
      console.log('✅ esc 指令成功，已发送两次 ESC 键');

      // 清空 PTY 写入记录
      app.pty.clearWrittenData();

      // Step 7: 发送 /exit 退出 Claude
      console.log('\n📍 Step 7: 发送 /exit');
      await app.handleChannelText('/exit');

      expect(app.intentParser.getSession().mode).toBe('idle');
      expect(app.taskStatus.isRunning).toBe(false);
      expect(app.terminalBuffer).toBe('');
      expect(app.channel.buffer).toBe('');
      console.log('✅ /exit 命令成功，会话已清理');

      // Step 8: 再次发送 -status 确认状态
      console.log('\n📍 Step 8: 发送 -status 确认状态');
      await app.handleChannelText('-status');

      lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('系统状态');
      expect(lastMsg.text).toContain('空闲');
      expect(lastMsg.text).not.toContain('Claude 活跃');
      console.log('✅ -status 命令成功，显示空闲状态');

      // 验证整个流程的消息数量
      console.log('\n📊 测试总结:');
      console.log(`   总消息数: ${messages.length}`);
      console.log('   流程验证通过 ✅');
    });

    it('空闲状态下发送自然语言应提示 Claude 未启动', async () => {
      await app.handleChannelText('帮我写代码');

      const lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('Claude 终端未启动');
    });

    it('空闲状态下发送 esc 应提示无需终止', async () => {
      await app.handleChannelText('esc');

      const lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('Claude 未启动');
    });

    it('重复启动 Claude 应提示已在运行', async () => {
      await app.handleChannelText('-claude');
      await app.handleChannelText('-claude');

      const messages = app.channel.messages;
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.text).toContain('已在运行中');
    });
  });

  describe('缓冲区清理测试', () => {
    it('/exit 后缓冲区应该被清空', async () => {
      // 启动 Claude
      await app.handleChannelText('-claude');

      // 模拟缓冲区有内容
      app.terminalBuffer = 'some buffered content';
      app.channel.buffer = 'channel buffer content';
      app.outputBuffer.pending = 'output buffer content';

      // 退出
      await app.handleChannelText('/exit');

      // 验证缓冲区已清空
      expect(app.terminalBuffer).toBe('');
      expect(app.channel.buffer).toBe('');
      expect(app.outputBuffer.pending).toBe('');
    });

    it('esc 后相关状态应该被重置', async () => {
      // 启动 Claude
      await app.handleChannelText('-claude');

      // 设置一些状态
      app.waitingForUserReply = true;
      app.lastInteractionBufferEnd = 100;
      app.lastAnalyzedPosition = 50;

      // 发送 esc
      await app.handleChannelText('esc');

      // 验证状态已重置
      expect(app.waitingForUserReply).toBe(false);
      expect(app.lastInteractionBufferEnd).toBe(0);
      expect(app.lastAnalyzedPosition).toBe(0);
    });
  });

  describe('目录操作测试', () => {
    it('切换到不存在的目录应失败', async () => {
      await app.handleChannelText('-cd ./non-existent-dir');

      const lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('切换失败');
    });

    it('切换到白名单外的目录应失败', async () => {
      await app.handleChannelText('-cd /tmp/outside-whitelist');

      const lastMsg = app.channel.getLastMessage();
      expect(lastMsg.text).toContain('切换失败');
    });
  });
});
