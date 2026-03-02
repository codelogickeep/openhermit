/**
 * 交互上下文管理
 * 用于保存非标准交互的上下文，在用户回复时带上上下文给 LLM 解析
 */

import logger from '../utils/logger.js';

class InteractionContext {
  constructor() {
    this.activeInteraction = null;
    this.maxOutputLength = 4000; // 保存的最大终端输出长度
  }

  /**
   * 保存交互上下文
   * @param {string} id - 交互唯一标识
   * @param {object} analysis - LLM 分析结果
   * @param {string} terminalOutput - 原始终端输出
   */
  setContext(id, analysis, terminalOutput) {
    // 截取终端输出，避免过长
    const truncatedOutput = terminalOutput.length > this.maxOutputLength
      ? terminalOutput.slice(-this.maxOutputLength)
      : terminalOutput;

    this.activeInteraction = {
      id,
      analysis,
      terminalOutput: truncatedOutput,
      timestamp: Date.now()
    };

    logger.debug({ id, analysisType: analysis?.type }, '📌 保存交互上下文');
  }

  /**
   * 获取当前交互上下文
   * @returns {object|null} 交互上下文
   */
  getContext() {
    // 检查是否过期（5分钟）
    if (this.activeInteraction) {
      const age = Date.now() - this.activeInteraction.timestamp;
      if (age > 5 * 60 * 1000) {
        logger.debug('⏰ 交互上下文已过期，清除');
        this.clearContext();
        return null;
      }
    }
    return this.activeInteraction;
  }

  /**
   * 清除交互上下文
   */
  clearContext() {
    if (this.activeInteraction) {
      logger.debug({ id: this.activeInteraction.id }, '🗑️ 清除交互上下文');
    }
    this.activeInteraction = null;
  }

  /**
   * 是否有活跃的交互上下文
   * @returns {boolean}
   */
  hasContext() {
    return this.getContext() !== null;
  }
}

// 单例
let instance = null;

export function getInteractionContext() {
  if (!instance) {
    instance = new InteractionContext();
  }
  return instance;
}

export default InteractionContext;
