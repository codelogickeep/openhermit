#!/usr/bin/env node

/**
 * OpenHermit - Claude Code 钉钉监控服务
 *
 * 监控模式：接收 Claude Code Hook 事件，推送到钉钉
 *
 * 使用流程：
 * 1. openhermit init     # 初始化 hooks 配置
 * 2. claude              # 正常启动 Claude Code
 * 3. openhermit          # 启动监控服务
 */

import { createRequire } from 'module';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

// 解析命令行参数
const args = process.argv.slice(2);

// 显示版本号
if (args.includes('-v') || args.includes('--version')) {
  console.log(`openhermit v${packageJson.version}`);
  process.exit(0);
}

// 显示帮助
if (args.includes('-h') || args.includes('--help')) {
  console.log(`
OpenHermit (开源寄居蟹) v${packageJson.version} - Claude Code 钉钉监控服务

用法:
  openhermit                     启动监控服务
  openhermit init [项目路径]     初始化 hooks 配置
                                 - 无参数: 注入到 ~/.claude/（全局）
                                 - 带路径: 为指定项目初始化
  openhermit uninit              移除 hooks 配置
  openhermit -v, --version       显示版本号
  openhermit -h, --help          显示帮助信息

示例:
  openhermit init                    # 全局初始化（推荐）
  openhermit init ~/projects/myapp  # 为特定项目初始化
  openhermit                         # 启动监控服务

使用流程:
  1. openhermit init         # 一次性初始化 hooks
  2. claude                  # 在任意终端启动 Claude Code
  3. openhermit              # 启动监控，接收钉钉通知

详细文档: https://github.com/codelogickeep/openhermit
`);
  process.exit(0);
}

// init 命令
if (args[0] === 'init') {
  const { initHermit } = await import('./commands/init.js');
  const force = args.includes('--force');
  // 获取项目路径参数
  const projectPath = args.find(arg => !arg.startsWith('-') && arg !== 'init');
  await initHermit({ force, projectPath });
  process.exit(0);
}

// uninit 命令
if (args[0] === 'uninit') {
  const { uninitHermit } = await import('./commands/uninit.js');
  const projectPath = args.find(arg => !arg.startsWith('-') && arg !== 'uninit');
  await uninitHermit({ projectPath });
  process.exit(0);
}

// ========== 以下是监控模式启动逻辑 ==========

const { getDingTalkAppKey, getDingTalkAppSecret, getDingTalkUserId, getDashScopeApiKey } = await import('./config/index.js');
const { default: DingTalkChannel } = await import('./channel/dingtalk.js');
const { default: logger } = await import('./utils/logger.js');
const { getLLMClient, getInteractionAnalyzer, getInteractionContext } = await import('./llm/index.js');
const { getIPCServer, getHookHandler, InteractionState, getCommandManager } = await import('./core/index.js');

// 全局异常处理
process.on('unhandledRejection', (reason, promise) => {
  if (reason && (reason.code === 'ECONNRESET' || reason.code === 'ETIMEDOUT' || reason.code === 'ENOTFOUND')) {
    logger.warn({ code: reason.code, message: reason.message }, '连接失败');
    return;
  }
  console.error('=== 未处理的 Promise 拒绝 ===');
  console.error('Error:', reason);
  logger.error({ reason }, '未处理的 Promise 拒绝');
});

process.on('uncaughtException', (error) => {
  logger.error({ error: error.message }, '未捕获的异常');
});

/**
 * OpenHermit 监控服务
 */
class OpenHermit {
  constructor() {
    // 钉钉通道
    this.channel = new DingTalkChannel();

    // LLM 服务
    this.llmClient = getLLMClient();
    this.interactionAnalyzer = getInteractionAnalyzer();
    this.interactionContext = getInteractionContext();
    this.smartMode = !!getDashScopeApiKey();

    // Hook 系统
    this.ipcServer = getIPCServer();
    this.hookHandler = getHookHandler();
    this.commandManager = getCommandManager();

    if (this.smartMode) {
      logger.info('智能交互模式已启用');
    }
  }

  /**
   * 初始化 LLM 连接
   */
  async initLLM() {
    if (!this.llmClient.isAvailable()) {
      logger.warn('LLM 客户端初始化失败，智能功能将不可用');
      this.smartMode = false;
      return;
    }

    logger.info('正在测试 LLM 连接...');
    try {
      const start = Date.now();
      await this.llmClient.chat('Hello', {
        maxTokens: 10,
        systemPrompt: '你是一个测试助手。请简短回复。'
      });
      const elapsed = Date.now() - start;
      logger.info({ model: this.llmClient.model, elapsed: `${elapsed}ms` }, 'LLM 连接测试成功');
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 连接测试失败');
      this.smartMode = false;
    }
  }

  /**
   * 初始化 Hook 系统
   */
  async initHookSystem() {
    logger.info('正在初始化 Hook 系统...');

    // 设置 Hook Handler 回调
    this.hookHandler.setCallbacks({
      onStateChange: (newState, oldState) => {
        logger.info({ from: oldState, to: newState }, 'Hook 状态变更');
      },
      onSendMessage: async (msgData) => {
        logger.info({ type: msgData.type }, '📤 Hook 消息发送到钉钉');
        await this.channel.send(msgData.message, { immediate: true });
      }
    });

    // 设置 CommandManager 回调
    this.commandManager.onTimeout = (result) => {
      this.handleCommandTimeout(result);
    };
    this.commandManager.onCommandProcessed = (commandInfo) => {
      logger.info({ commandId: commandInfo.commandId }, '✅ 命令已被 Claude Code 执行');
    };

    // 监听钉钉消息
    this.channel.on('text', (text, userId, meta) => {
      this.handleDingTalkMessage(text, userId, meta);
    });

    // 注册 IPC 事件处理
    this.ipcServer.on('pre-tool', (data) => this.hookHandler.handlePreToolUse(data));
    this.ipcServer.on('notification', (data) => this.hookHandler.handleNotification(data));
    this.ipcServer.on('stop', (data) => this.hookHandler.handleStop(data));

    // 注册命令相关 IPC 端点
    this.ipcServer.on('command-processed', (data) => this.commandManager.handleCommandProcessed(data));
    this.ipcServer.on('command-timeout', (data) => this.commandManager.handleCommandTimeout(data));

    // 启动 IPC Server
    try {
      await this.ipcServer.start();
      logger.info({ port: this.ipcServer.port }, '🔒 Hook IPC Server 已启动');
    } catch (error) {
      logger.error({ error: error.message }, 'IPC Server 启动失败');
      throw error;
    }
  }

  /**
   * 处理钉钉消息
   * @param {string} text - 消息文本
   * @param {string} userId - 用户 ID
   * @param {object} meta - 元数据
   */
  async handleDingTalkMessage(text, userId, meta) {
    logger.info({ text: text.substring(0, 50), userId, isVoice: meta.isVoiceMessage }, '📥 收到钉钉消息');

    // 检查是否可以接收命令
    if (this.commandManager.canAcceptCommand()) {
      const session = this.commandManager.getActiveSession();

      try {
        // 写入命令文件
        const commandInfo = this.commandManager.writeCommand(
          session.cwd,
          text,
          {
            source: 'dingtalk',
            userId: userId,
            isVoiceMessage: meta.isVoiceMessage,
            sessionId: session.sessionId
          }
        );

        logger.info({ commandId: commandInfo.commandId }, '📝 命令已写入，等待 Claude 读取');

        // 发送确认消息
        const confirmMsg = this.generateCommandReceivedMessage(commandInfo);
        await this.channel.send(confirmMsg, { immediate: true });

      } catch (error) {
        logger.error({ error: error.message }, '❌ 写入命令失败');
        await this.channel.send('❌ 命令写入失败，请直接在终端输入。', { immediate: true });
      }
    } else {
      // Claude 不在 idle 状态
      const session = this.commandManager.getActiveSession();
      const stateDesc = session ? `当前状态: ${session.state}` : '没有活跃会话';
      await this.channel.send(`⚠️ Claude Code 当前不在等待输入状态。\n\n${stateDesc}\n\n请稍后再试或直接在终端输入。`, { immediate: true });
    }
  }

  /**
   * 生成命令已接收消息
   * @param {object} commandInfo - 命令信息
   * @returns {string}
   */
  generateCommandReceivedMessage(commandInfo) {
    return `## 📝 已收到指令

**项目**: \`${commandInfo.projectName}\`
**指令**: ${commandInfo.command.substring(0, 100)}${commandInfo.command.length > 100 ? '...' : ''}

命令已写入，将在 Claude Code 任务完成时执行。`;
  }

  /**
   * 处理命令超时
   * @param {object} result - 超时结果
   */
  async handleCommandTimeout(result) {
    const timeoutMsg = `## ⏰ 等待超时

**项目**: \`${result.projectName}\`
**超时**: ${result.timeout / 60} 分钟

请直接在终端输入或稍后重试。`;

    await this.channel.send(timeoutMsg, { immediate: true });
  }

  /**
   * 初始化应用
   */
  async init() {
    console.log('');
    console.log('🦀 OpenHermit 监控服务');
    console.log('====================');
    console.log('');

    // 验证钉钉配置
    const appKey = getDingTalkAppKey();
    const appSecret = getDingTalkAppSecret();
    if (!appKey || !appSecret) {
      console.error('❌ 请配置钉钉 DINGTALK_APP_KEY 和 DINGTALK_APP_SECRET');
      process.exit(1);
    }

    // 初始化 LLM（可选）
    if (this.smartMode) {
      await this.initLLM();
    } else {
      logger.warn('未配置 DashScope API Key，LLM 功能不可用');
    }

    // 初始化 Hook 系统
    await this.initHookSystem();

    // 连接钉钉
    try {
      await this.channel.connect();
    } catch (error) {
      logger.error({ error: error.message }, '连接钉钉失败');
      throw error;
    }

    // 发送启动通知
    await this.sendStartupMessage();

    console.log('✅ 监控服务已启动');
    console.log('');
    console.log('📋 等待 Claude Code Hook 事件...');
    console.log('   在任意终端运行 claude 即可');
    console.log('');
    logger.info('OpenHermit 监控服务启动完成');
  }

  /**
   * 发送启动通知
   */
  async sendStartupMessage() {
    const userId = getDingTalkUserId();
    if (!userId) {
      logger.warn('未配置 DINGTALK_USER_ID，无法发送启动通知');
      return;
    }

    const startupMsg = `## 🦀 OpenHermit 监控服务已启动

**版本**: v${packageJson.version}

### 📋 功能说明
- 接收 Claude Code 的 Hook 事件通知
- 支持任务完成、等待输入、工具确认等状态通知
- Claude Code 在独立终端中运行，互不干扰

### 💡 使用说明
- 在任意终端运行 \`claude\` 启动 Claude Code
- OpenHermit 会自动接收 Hook 事件并推送到钉钉
- 关闭 OpenHermit 不会影响 Claude Code 运行`;

    try {
      await this.channel.sendImmediate(startupMsg);
      logger.info('启动通知已发送到钉钉');
    } catch (error) {
      logger.warn({ error: error.message }, '发送启动消息失败');
    }
  }

  /**
   * 停止应用
   */
  stop() {
    logger.info('停止 OpenHermit...');
    this.channel.disconnect();
    this.ipcServer.stop();
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
  console.log('');
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
