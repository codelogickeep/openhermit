/**
 * Hook Handler
 * 处理 Claude Code Hooks 发来的事件
 */

import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';
import { getHookContext } from './hook-context.js';
import { getLLMClient } from '../llm/client.js';
import { HookEventPrompts } from '../llm/prompts/hook-event.js';
import { getCommandManager } from './command-manager.js';

/**
 * 权限确认状态
 */
const PermissionState = {
  PENDING: 'pending',
  ALLOWED: 'allowed',
  DENIED: 'denied',
  TIMEOUT: 'timeout'
};

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
    this.commandManager = getCommandManager();
    this.currentState = InteractionState.IDLE;

    // 当前会话信息
    this.currentSession = null;

    // 回调函数
    this.onStateChange = null;
    this.onSendMessage = null;

    // 待处理的权限确认 (permissionId -> permissionInfo)
    this.pendingPermissions = new Map();
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
   * @returns {object|null} 返回 { permissionId, needsConfirm } 或 null
   */
  async handlePreToolUse(data) {
    logger.info({ toolName: data.tool_name, permissionMode: data.permission_mode }, '收到 PreToolUse 事件');

    // 如果是 bypassPermissions 模式，不需要用户确认
    if (data.permission_mode === 'bypassPermissions') {
      logger.debug('bypassPermissions 模式，跳过确认通知');
      return null;
    }

    // 提取关键信息
    const event = {
      hookType: 'PreToolUse',
      sessionId: data.session_id,
      toolName: data.tool_name,
      toolInput: data.tool_input,
      transcriptPath: data.transcript_path,
      cwd: data.cwd,
      permissionMode: data.permission_mode,
      timestamp: Date.now()
    };

    // 保存上下文
    this.hookContext.set(event);

    // 切换状态
    this.setState(InteractionState.WAITING_CONFIRM);

    // 生成权限 ID
    const permissionId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 使用 LLM 解析生成用户友好消息
    let message;
    try {
      message = await this.generatePreToolMessage(event);
    } catch (error) {
      logger.error({ error: error.message }, '生成 PreToolUse 消息失败');
      message = this.generateSimplePreToolMessage(event);
    }

    // 添加权限 ID 到消息
    message += `\n\n**权限ID**: \`${permissionId}\``;
    message += '\n\n请回复 **y** 允许 或 **n** 拒绝';

    // 记录待处理的权限确认
    this.pendingPermissions.set(permissionId, {
      ...event,
      permissionId,
      state: PermissionState.PENDING,
      createdAt: Date.now()
    });

    // 发送到钉钉
    if (this.onSendMessage) {
      this.onSendMessage({
        type: 'permission_confirm',
        message: message,
        event: event,
        permissionId: permissionId
      });
    }

    // 返回给 Hook 脚本，告知需要等待用户确认
    return {
      permissionId,
      needsConfirm: true
    };
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
   * 处理权限决策
   * @param {object} data - 决策数据 { permissionId, decision }
   * @returns {object} 处理结果
   */
  handlePermissionDecision(data) {
    const { permissionId, decision } = data;
    logger.info({ permissionId, decision }, '📋 收到权限决策');

    const permissionInfo = this.pendingPermissions.get(permissionId);
    if (!permissionInfo) {
      logger.warn({ permissionId }, '未找到对应的权限请求');
      return { success: false, error: 'permission_not_found' };
    }

    // 更新状态
    permissionInfo.state = decision === 'allow' ? PermissionState.ALLOWED : PermissionState.DENIED;
    permissionInfo.decidedAt = Date.now();

    // 写入决策文件（供 Hook 脚本读取）
    this.writePermissionDecision(permissionInfo.cwd, permissionId, decision);

    // 清除上下文
    this.hookContext.clear();

    // 恢复运行状态
    this.setState(InteractionState.RUNNING);

    // 从待处理列表中移除
    this.pendingPermissions.delete(permissionId);

    return {
      success: true,
      permissionId,
      decision
    };
  }

  /**
   * 写入权限决策文件
   * @param {string} cwd - 工作目录
   * @param {string} permissionId - 权限 ID
   * @param {string} decision - 决策 (allow/deny)
   */
  writePermissionDecision(cwd, permissionId, decision) {
    if (!cwd) return;

    const permissionDir = path.join(cwd, '.claude', '.openhermit', 'permissions');
    const decisionFile = path.join(permissionDir, `${permissionId}.decision`);

    try {
      // 确保目录存在
      fs.mkdirSync(permissionDir, { recursive: true });

      // 写入决策
      fs.writeFileSync(decisionFile, decision);

      logger.info({ permissionId, decision, decisionFile }, '✅ 权限决策文件已写入');
    } catch (error) {
      logger.error({ error: error.message, decisionFile }, '❌ 写入权限决策文件失败');
    }
  }

  /**
   * 处理权限超时
   * @param {object} data - 超时数据 { permissionId, timeout }
   * @returns {object} 处理结果
   */
  handlePermissionTimeout(data) {
    const { permissionId, timeout } = data;
    logger.warn({ permissionId, timeout }, '⏰ 权限确认超时');

    const permissionInfo = this.pendingPermissions.get(permissionId);
    if (permissionInfo) {
      permissionInfo.state = PermissionState.TIMEOUT;
      this.pendingPermissions.delete(permissionId);
    }

    return {
      success: true,
      permissionId,
      timeout
    };
  }

  /**
   * 从钉钉消息中处理权限决策
   * @param {string} message - 用户消息
   * @returns {boolean} 是否是权限决策消息
   */
  processPermissionReply(message) {
    const trimmed = message.trim().toLowerCase();

    // 检查是否是 y/n 回复
    if (trimmed !== 'y' && trimmed !== 'n' &&
        trimmed !== 'yes' && trimmed !== 'no' &&
        trimmed !== '允许' && trimmed !== '拒绝') {
      return false;
    }

    // 找到最近的待处理权限请求
    const pendingPermission = this.findLatestPendingPermission();
    if (!pendingPermission) {
      return false;
    }

    // 解析决策
    const decision = (trimmed === 'y' || trimmed === 'yes' || trimmed === '允许') ? 'allow' : 'deny';

    // 处理决策
    this.handlePermissionDecision({
      permissionId: pendingPermission.permissionId,
      decision
    });

    return true;
  }

  /**
   * 查找最近的待处理权限请求
   * @returns {object|null}
   */
  findLatestPendingPermission() {
    let latest = null;
    let latestTime = 0;

    for (const [id, info] of this.pendingPermissions.entries()) {
      if (info.state === PermissionState.PENDING && info.createdAt > latestTime) {
        latest = info;
        latestTime = info.createdAt;
      }
    }

    return latest;
  }

  /**
   * 处理 Notification 事件
   * @param {object} data - 事件数据
   */
  async handleNotification(data) {
    logger.info({ notification: data.notification }, '收到 Notification 事件');

    // 提取通知类型
    const notificationType = data.notification_type || this.getNotificationType(data.notification);

    // 更新会话信息
    this.currentSession = {
      sessionId: data.session_id,
      cwd: data.cwd,
      projectName: data.cwd ? path.basename(data.cwd) : 'unknown',
      state: notificationType === 'idle_prompt' ? 'idle' : 'running',
      timestamp: Date.now()
    };

    // 更新 CommandManager 的活跃会话
    this.commandManager.setActiveSession(this.currentSession);

    const event = {
      hookType: 'Notification',
      sessionId: data.session_id,
      cwd: data.cwd,
      notification: data.notification,
      notificationType: notificationType,
      transcriptPath: data.transcript_path,
      timestamp: Date.now()
    };

    // 保存上下文
    this.hookContext.set(event);

    if (notificationType === 'idle_prompt' || notificationType === 'idle') {
      // 等待用户输入
      this.setState(InteractionState.WAITING_INPUT);

      if (this.onSendMessage) {
        const message = this.generateWaitingInputMessage(event);
        this.onSendMessage({
          type: 'waiting_input',
          message: message,
          event: event
        });
      }
    } else if (notificationType === 'permission') {
      // 需要权限确认（通常 PreToolUse 已经处理）
      logger.debug('Notification: 权限请求');
    }
  }

  /**
   * 生成等待输入消息
   * @param {object} event - 事件数据
   * @returns {string}
   */
  generateWaitingInputMessage(event) {
    const projectName = event.cwd ? path.basename(event.cwd) : '未知项目';
    return `## ⏳ 等待输入

**项目**: \`${projectName}\`

Claude Code 任务完成，正在等待您的指令。

发送消息后，命令将在 Claude Code 下次停止时执行。`;
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

    // 提取任务信息
    const lastMessage = data.last_assistant_message || '';
    const taskSummary = this.extractTaskSummary(lastMessage);

    // 用 taskSummary（纯文本摘要）检测是否需要用户输入
    // 避免Markdown表格中的版本号等被误判
    const needsUserInput = this.detectUserInputRequired(taskSummary);

    const event = {
      hookType: 'Stop',
      sessionId: data.session_id,
      cwd: data.cwd,
      projectName: data.cwd ? path.basename(data.cwd) : 'unknown',
      stopReason: data.stop_reason,
      transcriptPath: data.transcript_path,
      lastAssistantMessage: lastMessage,
      needsUserInput: needsUserInput,
      taskSummary: taskSummary,
      timestamp: Date.now()
    };

    // 切换状态为 completed
    this.setState(InteractionState.COMPLETED);

    // 更新或创建会话，状态设为 completed
    // 这样用户在收到"任务完成"通知后可以立即发送下一条命令
    const currentSession = this.commandManager.getActiveSession();
    this.commandManager.setActiveSession({
      sessionId: data.session_id,
      cwd: data.cwd,
      projectName: event.projectName,
      state: 'completed',
      timestamp: Date.now(),
      // 保留之前的一些信息（如果有）
      ...(currentSession?.sessionId === data.session_id ? currentSession : {})
    });

    // 清除 Hook 上下文（保留会话信息）
    this.hookContext.clear();

    // 只有需要用户输入时才发送钉钉消息
    // 不需要用户交互的任务静默完成，不打扰用户
    if (needsUserInput && this.onSendMessage) {
      const message = this.generateTaskCompletedMessage(event);
      this.onSendMessage({
        type: 'completed',
        message: message,
        event: event
      });
    } else if (!needsUserInput) {
      logger.info('任务完成，无需用户交互，静默放行');
    }

    // 返回 needsUserInput 标志，供 Stop Hook 决定是否轮询
    return { needsUserInput };
  }

  /**
   * 从最后一条消息中提取任务摘要
   * @param {string} message - 消息内容
   * @returns {string}
   */
  extractTaskSummary(message) {
    if (!message) return '任务已完成';

    // 尝试提取第一行或前100个字符作为摘要
    const lines = message.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstLine = lines[0].replace(/^#+\s*/, '').trim();
      if (firstLine.length <= 100) {
        return firstLine;
      }
      return firstLine.substring(0, 97) + '...';
    }

    return '任务已完成';
  }

  /**
   * 检测消息是否需要用户输入
   * @param {string} message - 消息内容
   * @returns {boolean}
   */
  detectUserInputRequired(message) {
    if (!message) return false;

    // 检测选项列表 (1. 2. 3. 或 1、2、3、)
    if (/\d+[\.、\)]\s+/.test(message)) return true;

    // 检测问题结尾
    if (/？$|[?？]$/.test(message)) return true;

    // 检测确认提示 (y/n, 确认, 选择)
    if (/\(y\/n\)|\[y\/n\]|确认|选择|请(选择|回复|输入)/.test(message)) return true;

    return false;
  }

  /**
   * 生成任务完成消息
   * @param {object} event - 事件数据
   * @returns {string}
   */
  generateTaskCompletedMessage(event) {
    const projectName = event.projectName || '未知项目';

    // 如果需要用户输入，发送完整消息
    if (event.needsUserInput && event.lastAssistantMessage) {
      return `## ⏳ 等待您的选择

**项目**: \`${projectName}\`

${event.lastAssistantMessage}

---
请直接回复选项编号或内容。`;
    }

    // 否则发送简化摘要
    return `## ✅ 任务完成

**项目**: \`${projectName}\`
**摘要**: ${event.taskSummary}

请继续发送指令或等待下次任务完成。`;
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
