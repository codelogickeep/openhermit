/**
 * MessageHandler - 消息处理模块
 * 负责处理从钉钉通道接收的消息
 */

import { exec } from 'child_process';
import logger from '../utils/logger.js';
import { IntentTypes } from '../intent/index.js';
import { getSecurityAnalyzer, RiskLevel } from './security.js';

// 内置命令列表
const BUILTIN_COMMANDS = ['cd', 'ls', 'claude', 'status', 'help'];

/**
 * 消息处理类
 */
export class MessageHandler {
  constructor() {
    this.securityAnalyzer = getSecurityAnalyzer();
  }

  /**
   * 处理钉钉收到的文本
   * @param {string} text - 文本内容
   * @param {string} senderId - 发送者 ID
   * @param {object} context - 上下文对象
   * @param {object} metadata - 消息元数据
   */
  async handleChannelText(text, senderId, context, metadata = {}) {
    const {
      channel,
      intentParser,
      interactionContext,
      smartMode,
      writeCommand,
      systemCommands,
      hitlController,
      clearClaudeSession
    } = context;

    const trimmed = text.trim();

    // 打印接收日志（区分语音消息）
    if (metadata.isVoiceMessage) {
      logger.info({ text: trimmed, senderId }, '🎤 收到语音消息');
    } else {
      logger.info({ text: trimmed, senderId }, '收到钉钉消息');
    }

    // 检测 ESC 指令：终止 Claude Code 当前任务
    if (trimmed.toLowerCase() === 'esc' || trimmed === '\x1b' || trimmed === 'escape') {
      hitlController.handleEscCommand(context);
      return;
    }

    // HITL 激活状态下，优先处理 y/n 回复
    if (context.hitlActive) {
      const lower = trimmed.toLowerCase();
      if (lower === 'y' || lower === 'yes') {
        // 检查是安全确认还是 Claude 内部确认
        if (context.securityPendingCommand) {
          // 安全确认：需要 app 实例来执行命令
          // 这里通过 context 回调处理
          hitlController.handleSecurityApprove(context, context.app);
        } else {
          // Claude 内部确认
          hitlController.handleApprove(context);
        }
        return;
      } else if (lower === 'n' || lower === 'no') {
        // 检查是安全确认还是 Claude 内部确认
        if (context.securityPendingCommand) {
          hitlController.handleSecurityReject(context);
        } else {
          hitlController.handleReject(context);
        }
        return;
      }
      // 其他文本提示用户先处理审批
      channel.send('⚠️ 当前有待审批的操作，请先回复 y(同意) 或 n(拒绝)', { immediate: true });
      return;
    }

    // 获取当前会话状态
    const session = intentParser.getSession();
    const isClaudeActive = session.mode === 'claude_active';

    // ==================== Claude 终端运行中 ====================
    if (isClaudeActive) {
      // -status 命令：特殊处理，获取 Claude 状态
      if (trimmed === '-status') {
        systemCommands.handle(trimmed, context);
        return;
      }

      // 其他 - 前缀命令：提示用户
      if (trimmed.startsWith('-')) {
        channel.send(`⚠️ Claude 活跃时，系统命令需使用 \`!\` 前缀\n\n例如： \`!ls\` 查看目录`, { immediate: true });
        return;
      }

      // 系统命令（! 前缀）- 需要安全检测
      if (trimmed.startsWith('!')) {
        const command = trimmed.slice(1).trim();
        // 检查是否是内置命令
        const cmd = command.split(/\s+/)[0].toLowerCase();
        if (BUILTIN_COMMANDS.includes(cmd)) {
          systemCommands.handle(`-${command}`, context);
          return;
        }
        // 否则作为 shell 命令执行
        await this.handleBashCommandWithSecurity(command, context);
        return;
      }

      // 检测 /exit 命令：退出 Claude Code 后需要清理缓冲区
      const isExitCommand = trimmed === '/exit' || trimmed.toLowerCase() === 'exit';

      // 检查是否有交互上下文（用户正在回复选择/确认等）
      if (interactionContext.hasContext() && smartMode) {
        // 有上下文，用 LLM 解析用户回复
        await this.handleContextualReply(trimmed, context);
      } else {
        // 无上下文，直接写入 PTY
        writeCommand(trimmed);

        // 发送状态反馈给用户
        channel.send('📤 消息已发送，Claude 正在处理...', { immediate: true });
      }

      // 如果是退出命令，清理缓冲区和重置状态
      if (isExitCommand) {
        clearClaudeSession(context);
      }
      return;
    }

    // ==================== Claude 终端未运行（Idle 模式）====================
    // OpenHermit 系统命令（- 前缀）
    if (trimmed.startsWith('-')) {
      const cmd = trimmed.slice(1).trim().split(/\s+/)[0].toLowerCase();

      // 如果是内置命令，直接执行
      if (BUILTIN_COMMANDS.includes(cmd)) {
        systemCommands.handle(trimmed, context);
        return;
      }

      // 非内置命令，使用 LLM 意图识别
      if (smartMode) {
        await this.handleWithLLMIntent(trimmed, context);
        return;
      }

      // 无智能模式，提示未知命令
      channel.send(`❌ 未知命令: \`-${cmd}\`\n\n使用 \`-help\` 查看可用命令。`, { immediate: true });
      return;
    }

    // Bash 命令（! 前缀）- 需要安全检测
    if (trimmed.startsWith('!')) {
      const command = trimmed.slice(1).trim();
      await this.handleBashCommandWithSecurity(command, context);
      return;
    }

    // 无前缀消息：使用 LLM 意图识别
    if (smartMode) {
      await this.handleWithLLMIntent(trimmed, context);
      return;
    }

    // 无智能模式，提示启动 Claude
    channel.send(`⚠️ Claude 终端未启动\n\n使用 \`-claude\` 启动，或发送 \`-help\` 查看帮助`, { immediate: true });
  }

  /**
   * 使用 LLM 进行意图识别并处理
   * @param {string} userMessage - 用户消息
   * @param {object} context - 上下文对象
   */
  async handleWithLLMIntent(userMessage, context) {
    const { channel, intentParser, llmClient, pty, writeCommand, systemCommands } = context;

    try {
      logger.info({ message: userMessage }, '🤖 使用 LLM 进行意图识别');

      // 使用 LLM 客户端进行意图解析
      const intent = await llmClient.parseIntent(userMessage);
      logger.info({ intent }, '意图解析结果');

      switch (intent.type) {
        case IntentTypes.SHELL_COMMAND: {
          // Shell 命令：执行前进行安全检测
          const command = intent.command;
          const securityResult = this.securityAnalyzer.analyzeCommandRisk(command);

          if (securityResult.level === RiskLevel.CRITICAL) {
            // 拒绝执行
            const report = this.securityAnalyzer.generateRiskReport(securityResult);
            channel.send(report, { immediate: true });
            logger.warn({ command, risks: securityResult.risks }, '命令被安全检测拒绝');
            return;
          }

          if (securityResult.level === RiskLevel.HIGH) {
            // 高风险：需要用户确认
            const report = this.securityAnalyzer.generateRiskReport(securityResult);
            const confirmMsg = `${report}\n\n**待执行命令:** \`${command}\`\n\n请回复 y(同意) 或 n(拒绝)`;
            hitlController.setSecurityPending(context, command);
            channel.send(confirmMsg, { immediate: true });
            logger.info({ command }, '高风险命令等待用户确认');
            return;
          }

          // 执行命令（结果会在 executeShellCommand 中发送）
          logger.info({ command }, '执行 shell 命令');
          this.executeShellCommand(command, context);
          break;
        }

        case IntentTypes.CLAUDE_COMMAND: {
          // Claude 命令：启动 Claude 并传入任务
          this.executeClaudeCommand(intent.command, { explicit: true }, context);
          break;
        }

        case IntentTypes.BUILT_IN: {
          // 内置命令
          let cmdStr = intent.command;
          // 确保有 - 前缀
          if (!cmdStr.startsWith('-')) {
            cmdStr = '-' + cmdStr;
          }
          // 添加参数
          if (intent.params?.args) {
            cmdStr += ' ' + intent.params.args;
          }

          // 安全检测
          const securityResult = this.securityAnalyzer.analyzeCommandRisk(cmdStr);
          if (securityResult.level === RiskLevel.CRITICAL) {
            const report = this.securityAnalyzer.generateRiskReport(securityResult);
            channel.send(report, { immediate: true });
            logger.warn({ command: cmdStr, risks: securityResult.risks }, '内置命令被安全检测拒绝');
            return;
          }

          logger.info({ command: cmdStr }, '执行内置命令');
          systemCommands.handle(cmdStr, context);
          break;
        }

        default: {
          // 未知意图：默认作为 Claude 命令
          logger.warn({ intent }, '未知意图类型，默认作为 Claude 命令处理');
          this.executeClaudeCommand(userMessage, { explicit: true }, context);
        }
      }
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 意图识别失败');
      // 降级：作为 Claude 命令处理
      this.executeClaudeCommand(userMessage, { explicit: true }, context);
    }
  }

  /**
   * 执行 Shell 命令
   * @param {string} command - 命令
   * @param {object} context - 上下文对象
   */
  executeShellCommand(command, context) {
    const { channel, pty } = context;
    const workingDir = pty.getWorkingDir();

    exec(command, { cwd: workingDir, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        channel.send(`❌ 命令执行失败:\n\`\`\`\n${error.message}\n\`\`\``, { immediate: true });
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

      channel.send(`## 💻 命令结果\n\n\`\`\`bash\n$ ${command}\n\`\`\`\n\n\`\`\`\n${result}\n\`\`\``, { immediate: true });
    });
  }

  /**
   * 处理 Bash 命令（带安全检测）
   * @param {string} command - 要执行的命令
   * @param {object} context - 上下文对象
   */
  async handleBashCommandWithSecurity(command, context) {
    const { channel, pty } = context;

    if (!command) {
      channel.send('用法: `!<命令>` - 在工作目录中执行 bash 命令', { immediate: true });
      return;
    }

    // 安全检测
    const securityResult = this.securityAnalyzer.analyzeCommandRisk(command);

    if (securityResult.level === RiskLevel.CRITICAL) {
      // 拒绝执行
      const report = this.securityAnalyzer.generateRiskReport(securityResult);
      channel.send(report, { immediate: true });
      logger.warn({ command, risks: securityResult.risks }, 'Bash 命令被安全检测拒绝');
      return;
    }

    if (securityResult.level === RiskLevel.HIGH) {
      // 高风险：需要用户确认
      const report = this.securityAnalyzer.generateRiskReport(securityResult);
      const confirmMsg = `${report}\n\n**待执行命令:** \`${command}\`\n\n请回复 y(同意) 或 n(拒绝)`;
      hitlController.setSecurityPending(context, command);
      channel.send(confirmMsg, { immediate: true });
      logger.info({ command }, '高风险 Bash 命令等待用户确认');
      return;
    }

    // 执行命令
    this.executeShellCommand(command, context);
  }

  /**
   * 处理带上下文的用户回复
   * @param {string} userReply - 用户回复
   * @param {object} context - 上下文对象
   */
  async handleContextualReply(userReply, context) {
    const { channel, interactionAnalyzer, interactionContext, pty } = context;

    try {
      logger.info('🤖 解析带上下文的用户回复');

      // 重置等待状态
      context.waitingForUserReply = false;

      // 用 LLM 解析
      const result = await interactionAnalyzer.parseUserReply(userReply);

      // 清除上下文
      interactionContext.clearContext();

      // 清理缓冲区：移除本次交互之前的内容，只保留最新内容
      // 这样下次分析时就不会包含旧的交互选项
      if (context.lastInteractionBufferEnd > 0 && context.terminalBuffer.length > context.lastInteractionBufferEnd) {
        context.terminalBuffer = context.terminalBuffer.slice(context.lastInteractionBufferEnd);
        logger.debug({ removedLength: context.lastInteractionBufferEnd }, '🧹 清理交互前的缓冲区内容');
      } else if (context.lastInteractionBufferEnd > 0) {
        // 如果缓冲区已经被更新但位置不对，清空缓冲区
        context.terminalBuffer = '';
      }
      context.lastInteractionBufferEnd = 0;
      context.lastAnalyzedPosition = 0;  // 重置分析位置

      // 发送解析结果到 PTY
      if (result.understood && result.input) {
        logger.info({
          input: result.input.replace(/\x1b/g, '\\e').replace(/\r/g, '\\r'),
          selectionType: result.selectionType
        }, '✅ LLM 解析用户回复成功');

        // 根据选择类型发送到 PTY
        if (result.selectionType === 'arrow' && result.steps) {
          // 方向键选择模式：步进写入，每次按键之间添加延迟
          const steppedInput = interactionAnalyzer.generateSteppedInput(result.steps, 50);
          logger.info({ steppedInput: steppedInput.map(s => ({ input: s.input.replace(/\x1b/g, '\\e').replace(/\r/g, '\\r'), delay: s.delay })) }, '🎹 步进写入 PTY');

          // 如果只有一步且是回车，直接同步写入（避免 setTimeout 问题）
          if (steppedInput.length === 1 && steppedInput[0].input === '\r') {
            logger.info('⌨️ 直接写入回车（单步优化）');
            pty.write('\r');
          } else {
            // 多步操作：使用 setTimeout 延迟
            let totalDelay = 0;
            for (const step of steppedInput) {
              const currentDelay = totalDelay;
              setTimeout(() => {
                logger.info({ input: step.input.replace(/\x1b/g, '\\e').replace(/\r/g, '\\r'), delay: currentDelay }, '⌨️ 延迟写入 PTY');
                pty.write(step.input);
              }, totalDelay);
              totalDelay += step.delay;
            }
          }
        } else if (result.selectionType === 'number') {
          // 数字选择模式：直接写入数字和回车
          pty.write(result.input);
        } else {
          // 文本模式：使用 writeCommand（会延迟发送回车）
          pty.write(result.input);
          if (!result.input.includes('\r')) {
            setTimeout(() => pty.write('\r'), 100);
          }
        }

        // 可选：给用户反馈
        if (result.feedback) {
          channel.send(`💡 ${result.feedback}`, { immediate: true });
        }
      } else {
        // 无法理解，直接发送原始输入
        logger.warn('LLM 无法理解用户回复，使用原始输入');
        pty.write(userReply);
        setTimeout(() => pty.write('\r'), 100);
      }
    } catch (error) {
      logger.error({ error: error.message }, '解析用户回复失败');
      // 降级：直接发送原始输入
      context.waitingForUserReply = false;
      interactionContext.clearContext();
      // 清理缓冲区
      if (context.lastInteractionBufferEnd > 0) {
        context.terminalBuffer = context.terminalBuffer.slice(context.lastInteractionBufferEnd);
      }
      context.lastInteractionBufferEnd = 0;
      context.lastAnalyzedPosition = 0;
      pty.write(userReply);
      setTimeout(() => pty.write('\r'), 100);
    }
  }

  /**
   * 执行 Claude 命令
   * @param {string} command - 命令内容
   * @param {object} params - 参数
   * @param {object} context - 上下文对象
   */
  executeClaudeCommand(command, params, context) {
    const { intentParser, writeCommand } = context;
    const session = intentParser.getSession();

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

      writeCommand(claudeCmd);
      session.setMode('claude_active');
    } else {
      // 已在 Claude 会话中，直接发送消息
      writeCommand(command);
    }
  }

  /**
   * 处理活跃模式下的消息（Claude 启动后）
   * @param {string} userMessage - 用户消息
   * @param {object} context - 上下文对象
   */
  async handleActiveMessage(userMessage, context) {
    const { channel, pty, terminalBuffer, smartMode, llmClient } = context;

    // 先刷新之前的缓冲区内容，让用户看到之前的输出
    if (context.outputBuffer.pending) {
      logger.info('用户发送消息，刷新输出缓冲区');
      channel.flushBuffer();
    }

    // 临时关闭静默模式 30 秒，让用户能看到 Claude 的响应
    channel.setSilentMode(false);

    // 清除之前的定时器
    if (context._silentTimer) {
      clearTimeout(context._silentTimer);
    }

    // 30 秒后恢复静默模式
    context._silentTimer = setTimeout(() => {
      channel.setSilentMode(true);
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

    if (smartMode && (isInteraction || extractedNumber)) {
      // 交互选择：使用 LLM 上下文分析
      try {
        const inputForAnalysis = extractedNumber ? String(extractedNumber) : userMessage;
        const result = await llmClient.contextProcess(terminalBuffer, inputForAnalysis);
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
            pty.write(input);
          } else if (selectionType === 'number') {
            // 数字选择模式：直接发送数字
            const valueToSend = extractedNumber || result.action.value;
            logger.info({ value: valueToSend }, '📤 数字选择模式');
            pty.write(String(valueToSend));
            setTimeout(() => {
              pty.write('\r');
            }, 50);
          } else if (selectionType === 'confirm') {
            // y/n 确认模式
            const valueToSend = result.action.value || (extractedNumber === 1 ? 'y' : 'n');
            logger.info({ value: valueToSend }, '✅ 确认模式');
            pty.write(valueToSend);
            setTimeout(() => {
              pty.write('\r');
            }, 50);
          } else {
            // 其他：直接发送
            const valueToSend = result.action.value || (extractedNumber ? String(extractedNumber) : userMessage);
            pty.write(valueToSend);
            setTimeout(() => {
              pty.write('\r');
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
    pty.write(userMessage);
    // 延迟发送回车，确保文本先被接收
    setTimeout(() => {
      pty.write('\r');
    }, 100);
  }

  /**
   * 处理空闲模式下的消息（Claude 启动前）
   * @param {string} userMessage - 用户消息
   * @param {object} context - 上下文对象
   */
  async handleIdleMessage(userMessage, context) {
    const { intentParser, writeCommand, systemCommands } = context;

    // 智能模式：使用 LLM 意图解析
    if (context.smartMode) {
      try {
        const intent = await intentParser.parse(userMessage);
        logger.info({ intent }, '意图解析结果');

        if (intent.type === IntentTypes.CLAUDE_COMMAND) {
          this.executeClaudeCommand(intent.command, intent.params, context);
          return;
        }

        if (intent.type === IntentTypes.SHELL_COMMAND) {
          logger.info({ command: intent.command }, '执行 shell 命令');
          // 不推送执行确认，直接执行
          writeCommand(intent.command);
          return;
        }

        if (intent.type === IntentTypes.BUILT_IN) {
          systemCommands.handle(`${intent.command}${intent.params.path ? ' ' + intent.params.path : ''}`, context);
          return;
        }

        // 默认：尝试作为 Claude 命令
        this.executeClaudeCommand(userMessage, { explicit: true }, context);
      } catch (error) {
        logger.error({ error: error.message }, '意图解析失败');
        // 降级：直接写入 PTY
        writeCommand(userMessage);
      }
    } else {
      // 非智能模式：直接写入 PTY
      writeCommand(userMessage);
    }
  }
}

/**
 * 创建 MessageHandler 实例
 * @returns {MessageHandler}
 */
export function getMessageHandler() {
  return new MessageHandler();
}

export default MessageHandler;
