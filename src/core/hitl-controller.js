/**
 * HitlController - HITL (Human-in-the-loop) 控制模块
 * 负责处理人机交互审批流程
 */

import logger from '../utils/logger.js';

/**
 * HITL 控制类
 */
export class HitlController {
  /**
   * 处理审批同意
   * @param {object} context - 上下文对象
   */
  handleApprove(context) {
    const { channel, writeCommand } = context;

    // 恢复输出
    context.hitlActive = false;

    // 发送批准消息
    channel.send('\n✅ 已批准，继续执行...\n');

    // 写入 y 到 PTY
    writeCommand('y');

    // 清空缓冲区
    context.pausedBuffer = '';
  }

  /**
   * 处理审批拒绝
   * @param {object} context - 上下文对象
   */
  handleReject(context) {
    const { channel, writeCommand } = context;

    // 恢复输出
    context.hitlActive = false;

    // 发送拒绝消息
    channel.send('\n❌ 已拒绝，命令未执行\n');

    // 写入 n 到 PTY
    writeCommand('n');

    // 清空缓冲区
    context.pausedBuffer = '';
  }

  /**
   * 处理安全确认同意
   * @param {object} context - 上下文对象
   * @param {object} app - OpenHermit 实例（用于访问 executeShellCommand）
   */
  handleSecurityApprove(context, app) {
    const { channel } = context;
    const pendingCommand = context.securityPendingCommand;
    const pendingCallback = context.securityPendingCallback;

    // 恢复状态
    context.hitlActive = false;
    context.securityPendingCommand = null;
    context.securityPendingCallback = null;

    channel.send('✅ 已批准执行高风险命令\n');

    // 执行待执行的命令
    if (pendingCallback) {
      pendingCallback();
    } else if (pendingCommand) {
      logger.info({ command: pendingCommand }, '执行用户批准的高风险命令');
      app.executeShellCommand(pendingCommand, context);
    }
  }

  /**
   * 处理安全确认拒绝
   * @param {object} context - 上下文对象
   */
  handleSecurityReject(context) {
    const { channel } = context;
    const pendingCommand = context.securityPendingCommand;

    // 恢复状态
    context.hitlActive = false;
    context.securityPendingCommand = null;
    context.securityPendingCallback = null;

    channel.send('❌ 已拒绝，高风险命令未执行\n');
    logger.info({ command: pendingCommand }, '用户拒绝执行高风险命令');
  }

  /**
   * 设置安全确认待执行状态
   * @param {object} context - 上下文对象
   * @param {string} command - 待执行的命令
   * @param {function} callback - 执行回调（可选）
   */
  setSecurityPending(context, command, callback = null) {
    context.hitlActive = true;
    context.securityPendingCommand = command;
    context.securityPendingCallback = callback;
  }

  /**
   * 处理 ESC 指令：终止 Claude Code 当前任务
   * 发送两次 ESC 键来中断当前操作
   * @param {object} context - 上下文对象
   */
  handleEscCommand(context) {
    const { channel, pty, intentParser, interactionContext } = context;
    const session = intentParser.getSession();

    if (session.mode !== 'claude_active') {
      channel.send('⚠️ Claude 未启动，无需终止', { immediate: true });
      return;
    }

    // 发送两次 ESC 键（\x1b）来终止 Claude Code 的当前任务
    logger.info('🛑 收到 ESC 指令，发送两次 ESC 键终止当前任务');

    // 发送第一次 ESC
    pty.write('\x1b');

    // 短暂延迟后发送第二次 ESC
    setTimeout(() => {
      pty.write('\x1b');
      logger.info('✅ 已发送两次 ESC 键');
    }, 100);

    // 发送反馈消息
    channel.send('🛑 已发送终止指令（ESC x2）', { immediate: true });

    // 重置相关状态
    context.waitingForUserReply = false;
    interactionContext.clearContext();
    context.lastInteractionBufferEnd = 0;
    context.lastAnalyzedPosition = 0;
  }

  /**
   * 清理 Claude 会话状态和缓冲区
   * 在 /exit 或 Claude 退出后调用
   * @param {object} context - 上下文对象
   */
  clearClaudeSession(context) {
    const { intentParser, channel, taskManager, terminalLogger } = context;
    logger.info('🧹 清理 Claude 会话状态和缓冲区');

    // 重置会话模式
    const session = intentParser.getSession();
    session.setMode('idle');

    // 清理终端缓冲区
    context.terminalBuffer = '';
    context.outputBuffer.pending = '';

    // 清理钉钉通道缓冲区
    channel.buffer = '';

    // 重置交互状态
    context.waitingForUserReply = false;
    context.interactionContext.clearContext();
    context.lastInteractionBufferEnd = 0;
    context.lastAnalyzedPosition = 0;

    // 重置任务状态
    if (taskManager) {
      taskManager.reset();
    } else {
      context.taskStatus = {
        isRunning: false,
        startTime: null,
        phase: 'idle'
      };
    }

    // 重置 HITL 状态
    context.hitlActive = false;
    context.pausedBuffer = '';

    logger.info('✅ Claude 会话已清理');
  }
}

/**
 * 创建 HitlController 实例
 * @returns {HitlController}
 */
export function getHitlController() {
  return new HitlController();
}

export default HitlController;
