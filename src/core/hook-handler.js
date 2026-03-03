/**
 * Hook Handler
 * 处理 Claude Code Hooks 发来的事件
 */

import logger from '../utils/logger.js';
import { getHookContext } from './hook-context.js';
import { getLLMClient } from '../llm/client.js';
import { HookEventPrompts } from '../llm/prompts/hook-event.js';

/**
 * 交互状态枚举
 */
export const InteractionState = {
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING_CONFIRM: 'waiting_confirm',
  WAITING_INPUT: 'waiting_input',
  COMPLETED: 'completed'
};

/**
 * Hook Handler 类
 */
class HookHandler {
  constructor() {
    this.hookContext = getHookContext();
    this.llmClient = getLLMClient();
    this.currentState = InteractionState.IDLE;

    // 回调函数
    this.onStateChange = null;
    this.onSendMessage = null;
  }

  /**
   * 设置回调
   * @param {object} callbacks - 回调函数
   */
  setCallbacks({ onStateChange, onSendMessage }) {
    this.onStateChange = onStateChange;
    this.onSendMessage = onSendMessage;
  }

  /**
   * 获取当前状态
   * @returns {string}
   */
  getState() {
    return this.currentState;
  }

  /**
   * 设置状态
   * @param {string} state - 新状态
   */
  setState(state) {
    const oldState = this.currentState;
    this.currentState = state;
    if (this.onStateChange && oldState !== state) {
      this.onStateChange(state, oldState);
    }
    logger.debug({ from: oldState, to: state }, '状态变更');
  }

  /**
   * 处理 PreToolUse 事件
   * @param {object} data - 事件数据
   */
  async handlePreToolUse(data) {
    logger.info({ toolName: data.tool_name }, '收到 PreToolUse 事件');

    // 提取关键信息
    const event = {
      hookType: 'PreToolUse',
      sessionId: data.session_id,
      toolName: data.tool_name,
      toolInput: data.tool_input,
      transcriptPath: data.transcript_path,
      timestamp: Date.now()
    };

    // 保存上下文
    this.hookContext.set(event);

    // 切换状态
    this.setState(InteractionState.WAITING_CONFIRM);

    // 使用 LLM 解析生成用户友好消息
    try {
      const message = await this.generatePreToolMessage(event);

      // 发送到钉钉
      if (this.onSendMessage) {
        this.onSendMessage({
          type: 'confirmation',
          message: message,
          event: event
        });
      }
    } catch (error) {
      logger.error({ error: error.message }, '生成 PreToolUse 消息失败');

      // 降级：发送简单消息
      if (this.onSendMessage) {
        this.onSendMessage({
          type: 'confirmation',
          message: this.generateSimplePreToolMessage(event),
          event: event
        });
      }
    }
  }

  /**
   * 使用 LLM 生成用户友好的 PreToolUse 消息
   * @param {object} event - 事件数据
   * @returns {Promise<string>}
   */
  async generatePreToolMessage(event) {
    if (!this.llmClient.isAvailable()) {
      return this.generateSimplePreToolMessage(event);
    }

    try {
      const prompt = HookEventPrompts.preToolUse
        .replace('{{toolName}}', event.toolName)
        .replace('{{toolInput}}', JSON.stringify(event.toolInput, null, 2));

      const response = await this.llmClient.chat(prompt, {
        temperature: 0.3,
        maxTokens: 300,
        timeout: 10000
      });

      // 解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return this.formatPreToolResult(result);
      }
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 解析 PreToolUse 失败');
    }

    return this.generateSimplePreToolMessage(event);
  }

  /**
   * 格式化 PreToolUse 结果
   * @param {object} result - LLM 解析结果
   * @returns {string}
   */
  formatPreToolResult(result) {
    const { title, description, risk, suggestion } = result;

    let message = `## ⚠️ 需要确认\n\n`;
    message += `**${title || '操作请求'}**\n\n`;

    if (description) {
      message += `${description}\n\n`;
    }

    if (risk && risk !== 'low') {
      const riskEmoji = risk === 'high' ? '🔴' : '🟡';
      message += `${riskEmoji} **风险等级**: ${risk}\n\n`;
    }

    if (suggestion) {
      message += `💡 **建议**: ${suggestion}\n\n`;
    }

    message += '---\n';
    message += '请回复 **y** 确认 或 **n** 拒绝';

    return message;
  }

  /**
   * 生成简单的 PreToolUse 消息（降级方案）
   * @param {object} event - 事件数据
   * @returns {string}
   */
  generateSimplePreToolMessage(event) {
    const { toolName, toolInput } = event;

    let message = `## ⚠️ 需要确认\n\n`;
    message += `Claude 请求执行 **${toolName}** 操作\n\n`;

    if (toolInput) {
      if (toolName === 'Bash' && toolInput.command) {
        message += `\`\`\`bash\n${toolInput.command}\n\`\`\`\n\n`;
      } else if (toolInput.file_path) {
        message += `文件: ${toolInput.file_path}\n\n`;
      }
    }

    message += '---\n';
    message += '请回复 **y** 确认 或 **n** 拒绝';

    return message;
  }

  /**
   * 处理 Notification 事件
   * @param {object} data - 事件数据
   */
  async handleNotification(data) {
    logger.info({ notification: data.notification }, '收到 Notification 事件');

    const event = {
      hookType: 'Notification',
      sessionId: data.session_id,
      notification: data.notification,
      transcriptPath: data.transcript_path,
      timestamp: Date.now()
    };

    // 判断通知类型
    const notificationType = this.getNotificationType(data.notification);

    if (notificationType === 'idle') {
      // 等待用户输入
      this.hookContext.set(event);
      this.setState(InteractionState.WAITING_INPUT);

      if (this.onSendMessage) {
        this.onSendMessage({
          type: 'waiting_input',
          message: '## ⏳ 等待输入\n\nClaude 正在等待您的输入...',
          event: event
        });
      }
    } else if (notificationType === 'permission') {
      // 需要权限确认（通常 PreToolUse 已经处理）
      logger.debug('Notification: 权限请求');
    }
  }

  /**
   * 获取通知类型
   * @param {object} notification - 通知数据
   * @returns {string}
   */
  getNotificationType(notification) {
    if (!notification) return 'unknown';

    const text = notification.message || JSON.stringify(notification);

    if (text.includes('idle') || text.includes('waiting') || text.includes('input')) {
      return 'idle';
    }

    if (text.includes('permission') || text.includes('allow')) {
      return 'permission';
    }

    return 'unknown';
  }

  /**
   * 处理 Stop 事件
   * @param {object} data - 事件数据
   */
  async handleStop(data) {
    logger.info({ reason: data.stop_reason }, '收到 Stop 事件');

    const event = {
      hookType: 'Stop',
      sessionId: data.session_id,
      stopReason: data.stop_reason,
      transcriptPath: data.transcript_path,
      timestamp: Date.now()
    };

    // 切换状态
    this.setState(InteractionState.COMPLETED);

    // 清除上下文
    this.hookContext.clear();

    // 发送完成通知
    if (this.onSendMessage) {
      this.onSendMessage({
        type: 'completed',
        message: '## ✅ 任务完成\n\nClaude Code 已完成当前任务。',
        event: event
      });
    }
  }

  /**
   * 处理用户回复
   * @param {string} reply - 用户回复
   * @returns {Promise<{input: string, feedback: string}>}
   */
  async handleUserReply(reply) {
    const context = this.hookContext.get();

    if (!context) {
      // 没有上下文，直接返回原始回复
      return {
        input: reply.trim(),
        feedback: ''
      };
    }

    // 有上下文，使用 LLM 解析
    try {
      const result = await this.parseUserReplyWithContext(reply, context);

      // 清除上下文
      this.hookContext.clear();

      // 恢复运行状态
      this.setState(InteractionState.RUNNING);

      return result;
    } catch (error) {
      logger.error({ error: error.message }, '解析用户回复失败');

      // 降级：直接返回原始回复
      return {
        input: reply.trim(),
        feedback: ''
      };
    }
  }

  /**
   * 使用 LLM 解析用户回复（带上下文）
   * @param {string} reply - 用户回复
   * @param {object} context - Hook 上下文
   * @returns {Promise<{input: string, feedback: string}>}
   */
  async parseUserReplyWithContext(reply, context) {
    if (!this.llmClient.isAvailable()) {
      return this.fallbackParseReply(reply, context);
    }

    try {
      const prompt = HookEventPrompts.userReply
        .replace('{{context}}', JSON.stringify(context, null, 2))
        .replace('{{userReply}}', reply);

      const response = await this.llmClient.chat(prompt, {
        temperature: 0.2,
        maxTokens: 200,
        timeout: 10000
      });

      // 解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 解析用户回复失败');
    }

    return this.fallbackParseReply(reply, context);
  }

  /**
   * 降级：解析用户回复
   * @param {string} reply - 用户回复
   * @param {object} context - Hook 上下文
   * @returns {{input: string, feedback: string}}
   */
  fallbackParseReply(reply, context) {
    const trimmed = reply.trim().toLowerCase();

    // 简单映射
    if (trimmed === 'y' || trimmed === 'yes' || trimmed === '确认' || trimmed === '同意') {
      return { input: 'y', feedback: '✅ 已确认' };
    }

    if (trimmed === 'n' || trimmed === 'no' || trimmed === '拒绝' || trimmed === '取消') {
      return { input: 'n', feedback: '❌ 已拒绝' };
    }

    // 数字选择
    if (/^\d+$/.test(trimmed)) {
      return { input: trimmed, feedback: `已选择 ${trimmed}` };
    }

    // 其他情况直接返回
    return { input: reply.trim(), feedback: '' };
  }

  /**
   * 重置状态
   */
  reset() {
    this.currentState = InteractionState.IDLE;
    this.hookContext.clear();
    logger.debug('Hook Handler 状态已重置');
  }
}

// 单例
let instance = null;

/**
 * 获取 HookHandler 实例
 * @returns {HookHandler}
 */
export function getHookHandler() {
  if (!instance) {
    instance = new HookHandler();
  }
  return instance;
}

/**
 * 重置 HookHandler（用于测试）
 */
export function resetHookHandler() {
  if (instance) {
    instance.reset();
  }
  instance = null;
}

export { HookHandler };
