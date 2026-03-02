/**
 * TaskManager - 任务状态管理模块
 * 负责追踪和管理任务执行状态
 */

import logger from '../utils/logger.js';

/**
 * 任务状态枚举
 */
export const TaskPhase = {
  IDLE: 'idle',
  THINKING: 'thinking',
  ACTING: 'acting',
  WAITING_INPUT: 'waiting_input',
  COMPLETED: 'completed'
};

/**
 * 任务状态管理类
 */
export class TaskManager {
  constructor() {
    // 任务状态
    this.status = {
      isRunning: false,
      startTime: null,
      phase: TaskPhase.IDLE
    };

    // 延迟检测机制
    this.lastOutputTime = 0;

    // 超时完成检测机制
    this.completionCheckTimer = null;
    this.completionCheckTimeout = 30000; // 30秒无输出则检测
    this.lastCompletionCheckTime = 0;

    // 防重复发送完成通知
    this.lastCompletionNotificationTime = 0;
    this.completionNotificationCooldown = 5000; // 5秒内不重复发送完成通知
  }

  /**
   * 更新任务状态
   * @param {string} data - PTY 输出数据
   * @param {object} session - 意图解析会话
   */
  updateStatus(data, session) {
    // 检测任务开始
    if (session.mode === 'claude_active' && !this.status.isRunning) {
      this.status.isRunning = true;
      this.status.startTime = Date.now();
      this.status.phase = TaskPhase.THINKING;
    }

    // 检测等待输入
    if (/\(y\/n\)|\[.*\]|选择|确认|请输入|\?$/i.test(data)) {
      this.status.phase = TaskPhase.WAITING_INPUT;
    } else if (this.status.phase === TaskPhase.WAITING_INPUT) {
      // 恢复到 thinking
      this.status.phase = TaskPhase.THINKING;
    }
  }

  /**
   * 检测任务是否完成
   * 注意：规则检测只保留明确的完成标志，其他情况由 LLM 超时检测判断
   * @param {string} data - PTY 输出数据
   * @returns {boolean}
   */
  checkCompletion(data) {
    // 只在任务运行中才检测完成
    if (!this.status.isRunning) {
      return false;
    }

    // 检查是否在冷却期内（避免重复发送完成通知）
    const now = Date.now();
    if (now - this.lastCompletionNotificationTime < this.completionNotificationCooldown) {
      return false;
    }

    // 任务完成标志 - 只保留明确的 Claude Code 完成标志
    // 注意：移除了模糊的 idlePattern 检测，避免误判
    const completionPatterns = [
      // Claude Code 特有的完成标志
      /Crunched\s*(for|in)\s*\d+s/i,  // "Crunched for 38s" 表示任务完成
      /Brewed\s*(for|in)\s*\d+s/i,    // "Brewed for 43s" 表示任务完成
    ];

    const isCompleted = completionPatterns.some(p => p.test(data));

    if (isCompleted) {
      // 更新最后发送时间
      this.lastCompletionNotificationTime = now;

      this.status.phase = TaskPhase.COMPLETED;
      this.status.isRunning = false;

      // 清除超时检测定时器
      if (this.completionCheckTimer) {
        clearTimeout(this.completionCheckTimer);
        this.completionCheckTimer = null;
      }

      // 清除状态行，避免 ANSI 转义序列残留
      process.stdout.write('\r\x1b[K\n');
      logger.info({ dataMatch: data.slice(-100) }, '任务完成检测：检测到完成标志');
    }

    return isCompleted;
  }

  /**
   * 重置超时完成检测定时器
   * 每次有新输出时调用，如果长时间无输出则触发 LLM 分析
   * @param {object} options - 配置选项
   * @param {boolean} options.smartMode - 是否启用智能模式
   * @param {boolean} options.waitingForUserReply - 是否正在等待用户回复
   * @param {function} onTrigger - 超时触发回调
   */
  resetCompletionCheckTimer(options, onTrigger) {
    // 清除之前的定时器
    if (this.completionCheckTimer) {
      clearTimeout(this.completionCheckTimer);
    }

    // 只在任务运行中且智能模式下启用
    if (!this.status.isRunning || !options.smartMode || options.waitingForUserReply) {
      return;
    }

    // 更新最后输出时间
    this.lastOutputTime = Date.now();

    // 设置超时检测定时器
    this.completionCheckTimer = setTimeout(() => {
      // 检查是否真的没有新输出
      const timeSinceLastOutput = Date.now() - this.lastOutputTime;
      if (timeSinceLastOutput >= this.completionCheckTimeout - 1000) {
        logger.info({
          timeSinceLastOutput,
        }, '⏰ 超时触发 LLM 完成检测');
        if (onTrigger) {
          onTrigger();
        }
      }
      this.completionCheckTimer = null;
    }, this.completionCheckTimeout);
  }

  /**
   * 超时完成检测
   * 当长时间无输出时调用，使用 LLM 分析是否有后续动作需要用户确认
   * @param {string} buffer - 终端缓冲区内容
   * @param {object} analyzer - 交互分析器
   * @returns {Promise<object|null>} 分析结果
   */
  async checkCompletionByLLM(buffer, analyzer) {
    try {
      // 获取最近 100 行输出内容
      const lines = buffer.split('\n');
      const recentLines = lines.slice(-100);
      const recentOutput = recentLines.join('\n');

      if (!recentOutput || recentOutput.trim().length < 50) {
        // 缓冲区内容太少，直接标记完成
        this.status.phase = TaskPhase.COMPLETED;
        this.status.isRunning = false;
        logger.info('✅ 超时无输出，任务已完成（缓冲区内容太少）');
        process.stdout.write('\r\x1b[K\n');
        return { needsInteraction: false, type: 'none', taskCompleted: true };
      }

      logger.info({ lineCount: recentLines.length, charCount: recentOutput.length }, '🤖 超时检测：使用 LLM 分析是否有后续动作');

      // 调用 LLM 分析
      const analysis = await analyzer.analyze(recentOutput);

      logger.info({ analysis }, '📥 LLM 超时检测分析结果');

      // 如果 LLM 判断需要交互，返回分析结果（由调用方处理）
      if (analysis.needsInteraction) {
        logger.info({ type: analysis.type }, '🔄 LLM 判断需要用户确认后续动作');
        return analysis;
      }

      // 如果 LLM 判断任务完成
      if (analysis.taskCompleted) {
        this.status.phase = TaskPhase.COMPLETED;
        this.status.isRunning = false;
        logger.info('✅ 超时检测：LLM 判断任务已完成');
        process.stdout.write('\r\x1b[K\n');
        return analysis;
      }

      // 不需要交互且任务未明确完成，标记任务完成（超时默认完成）
      this.status.phase = TaskPhase.COMPLETED;
      this.status.isRunning = false;
      logger.info('✅ 超时无输出，任务已完成（无需后续动作）');

      // 清除状态行
      process.stdout.write('\r\x1b[K\n');

      return { needsInteraction: false, type: 'none', taskCompleted: true };
    } catch (error) {
      logger.error({ error: error.message }, 'LLM 超时检测失败');
      // 出错时也标记完成
      this.status.phase = TaskPhase.COMPLETED;
      this.status.isRunning = false;
      process.stdout.write('\r\x1b[K\n');
      return { needsInteraction: false, type: 'none', taskCompleted: true };
    }
  }

  /**
   * 重置任务状态
   */
  reset() {
    // 清除定时器
    if (this.completionCheckTimer) {
      clearTimeout(this.completionCheckTimer);
      this.completionCheckTimer = null;
    }

    this.status = {
      isRunning: false,
      startTime: null,
      phase: TaskPhase.IDLE
    };
    this.lastOutputTime = 0;
    this.lastCompletionCheckTime = 0;
  }

  /**
   * 更新最后输出时间
   */
  touchLastOutputTime() {
    this.lastOutputTime = Date.now();
  }

  /**
   * 获取运行时间（秒）
   * @returns {number}
   */
  getElapsedSeconds() {
    if (!this.status.startTime) return 0;
    return Math.floor((Date.now() - this.status.startTime) / 1000);
  }

  /**
   * 获取格式化的运行时间
   * @returns {string}
   */
  getElapsedFormatted() {
    const elapsed = this.getElapsedSeconds();
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}分${seconds}秒`;
  }
}

/**
 * 创建 TaskManager 实例
 * @returns {TaskManager}
 */
export function getTaskManager() {
  return new TaskManager();
}

export default TaskManager;
