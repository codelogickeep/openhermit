/**
 * Hook Context Store
 * 保存 Hook 事件的上下文， 用于用户回复时的 LLM 解析
 */

import logger from '../utils/logger.js';

/**
 * Hook Context 类
 */
class HookContext {
  constructor() {
    this.currentEvent = null;
    this.maxAge = 5 * 60 * 1000; // 5 分钟过期
  }

  /**
   * 保存事件上下文
   * @param {object} event - 事件数据
   */
  set(event) {
    this.currentEvent = {
      ...event,
      timestamp: Date.now()
    };
    logger.debug({ eventType: event.hookType, toolName: event.toolName }, '保存 Hook 上下文');
  }

  /**
   * 获取当前事件上下文
   * @returns {object|null}
   */
  get() {
    if (!this.currentEvent) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - this.currentEvent.timestamp > this.maxAge) {
      logger.debug('Hook 上下文已过期，清除');
      this.currentEvent = null;
      return null;
    }

    return this.currentEvent;
  }

  /**
   * 清除上下文
   */
  clear() {
    if (this.currentEvent) {
      logger.debug({ eventId: this.currentEvent.timestamp }, '清除 Hook 上下文');
    }
    this.currentEvent = null;
  }

  /**
   * 是否有活跃的上下文
   * @returns {boolean}
   */
  hasContext() {
    return this.get() !== null;
  }
}

// 单例
let instance = null;

/**
 * 获取 HookContext 实例
 * @returns {HookContext}
 */
export function getHookContext() {
  if (!instance) {
    instance = new HookContext();
  }
  return instance;
}

/**
 * 重置 HookContext（用于测试）
 */
export function resetHookContext() {
  if (instance) {
    instance.clear();
  }
  instance = null;
}

export { HookContext };
