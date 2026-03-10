import { getLLMClient } from '../llm/index.js';
import logger from '../utils/logger.js';

/**
 * 意图类型枚举
 */
export const IntentTypes = {
  CLAUDE_COMMAND: 'claude_command',   // 需要启动 Claude Code
  SHELL_COMMAND: 'shell_command',     // 直接 shell 命令
  BUILT_IN: 'built_in',               // 内置命令 (/cd, /ls, /restart)
  CONVERSATION: 'conversation',       // 对话交互（选择回复等）
  UNKNOWN: 'unknown'                  // 无法识别的意图
};

/**
 * 会话状态
 */
export class SessionState {
  constructor() {
    this.mode = 'idle';  // idle | claude_active | waiting_selection
    this.lastPrompt = '';
    this.selectionOptions = [];
    this.context = {};
  }

  setMode(mode) {
    this.mode = mode;
    logger.debug({ mode }, '会话模式切换');
  }

  setSelection(options, context = '') {
    this.mode = 'waiting_selection';
    this.selectionOptions = options;
    this.lastPrompt = context;
  }

  clearSelection() {
    this.mode = this.mode === 'waiting_selection' ? 'claude_active' : this.mode;
    this.selectionOptions = [];
    this.lastPrompt = '';
  }

  isWaitingSelection() {
    return this.mode === 'waiting_selection';
  }
}

/**
 * 意图解析器
 */
class IntentParser {
  constructor() {
    this.llmClient = getLLMClient();
    this.session = new SessionState();
  }

  /**
   * 解析用户消息
   * @param {string} userMessage - 用户消息
   * @returns {Promise<object>} 意图对象
   */
  async parse(userMessage) {
    const trimmed = userMessage.trim();

    // 1. 快速规则匹配 - 仅处理系统命令
    const simpleResult = this.quickParseSimple(trimmed);
    if (simpleResult) {
      logger.debug({ intent: simpleResult }, '系统命令，快速匹配');
      return simpleResult;
    }

    // 2. 其他所有内容：转发给 Claude
    return {
      type: IntentTypes.CLAUDE_COMMAND,
      command: trimmed,
      params: {},
      confidence: 1.0
    };
  }

  /**
   * 快速规则匹配 - 仅处理系统命令（- 前缀）
   * @param {string} userMessage - 用户消息
   * @returns {object|null} 意图对象或 null
   */
  quickParseSimple(userMessage) {
    const trimmed = userMessage.trim();

    // 空消息
    if (!trimmed) {
      return null;
    }

    // OpenHermit 系统命令（- 前缀）
    if (trimmed.startsWith('-')) {
      const parts = trimmed.slice(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();

      return {
        type: IntentTypes.BUILT_IN,
        command: cmd,
        params: { args: parts.slice(1).join(' ') },
        confidence: 1.0
      };
    }

    return null;
  }

  /**
   * 快速规则匹配 - 完整版（用于活跃模式下的交互解析）
   * @param {string} userMessage - 用户消息
   * @returns {object|null} 意图对象或 null
   */
  quickParse(userMessage) {
    const trimmed = userMessage.trim();
    const lower = trimmed.toLowerCase();

    // 空消息
    if (!trimmed) {
      return null;
    }

    // OpenHermit 系统命令（- 前缀）
    if (trimmed.startsWith('-')) {
      const parts = trimmed.slice(1).trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();

      return {
        type: IntentTypes.BUILT_IN,
        command: cmd,
        params: { args: parts.slice(1).join(' ') },
        confidence: 1.0
      };
    }

    // y/n 确认
    if (lower === 'y' || lower === 'yes') {
      return {
        type: IntentTypes.CONVERSATION,
        command: 'confirm',
        params: { value: 'y' },
        confidence: 1.0
      };
    }
    if (lower === 'n' || lower === 'no') {
      return {
        type: IntentTypes.CONVERSATION,
        command: 'confirm',
        params: { value: 'n' },
        confidence: 1.0
      };
    }

    // 数字选择
    if (/^\d+$/.test(trimmed)) {
      return {
        type: IntentTypes.CONVERSATION,
        command: 'select',
        params: { choice: parseInt(trimmed) },
        confidence: 0.95
      };
    }

    // 中文数字
    const chineseNumbers = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
      '第一个': 1, '第二个': 2, '第三个': 3, '第四个': 4, '第五个': 5
    };
    if (chineseNumbers[trimmed]) {
      return {
        type: IntentTypes.CONVERSATION,
        command: 'select',
        params: { choice: chineseNumbers[trimmed] },
        confidence: 0.95
      };
    }

    // Claude Code 启动命令
    if (trimmed === 'claude' || trimmed.startsWith('claude ')) {
      return {
        type: IntentTypes.CLAUDE_COMMAND,
        command: trimmed.slice(6).trim() || '开始对话',
        params: { explicit: true },
        confidence: 1.0
      };
    }

    // 中文启动命令
    const claudeStartPatterns = ['启动claude', '启动 claude', '开启claude', '开启 claude', '运行claude', '运行 claude', 'start claude'];
    for (const pattern of claudeStartPatterns) {
      if (lower === pattern || trimmed === pattern) {
        return {
          type: IntentTypes.CLAUDE_COMMAND,
          command: '开始对话',
          params: { explicit: true },
          confidence: 1.0
        };
      }
    }

    // 开发相关关键词 -> Claude 命令
    const devKeywords = ['帮我', '分析', '写', '创建', '修改', '删除', '重构', '优化', '调试', '修复', '实现', '添加', '移除', '解释', '文档'];
    for (const keyword of devKeywords) {
      if (trimmed.includes(keyword)) {
        return {
          type: IntentTypes.CLAUDE_COMMAND,
          command: trimmed,
          params: {},
          confidence: 0.85
        };
      }
    }

    // 英文开发关键词
    const engDevKeywords = ['help me', 'analyze', 'create', 'write', 'modify', 'fix', 'implement', 'add', 'remove', 'explain', 'refactor', 'optimize'];
    for (const keyword of engDevKeywords) {
      if (lower.includes(keyword)) {
        return {
          type: IntentTypes.CLAUDE_COMMAND,
          command: trimmed,
          params: {},
          confidence: 0.85
        };
      }
    }

    // 默认：根据会话状态决定
    return {
      type: this.session.mode === 'claude_active' ? IntentTypes.CONVERSATION : IntentTypes.CLAUDE_COMMAND,
      command: trimmed,
      params: {},
      confidence: 0.6
    };
  }

  /**
   * 解析选择响应
   * @param {string} userMessage - 用户消息
   * @returns {Promise<object>} 意图对象
   */
  async parseSelectionResponse(userMessage) {
    const options = this.session.selectionOptions;

    // 1. 简单输入直接处理
    const simpleResult = this.quickParseSimple(userMessage);
    if (simpleResult) {
      return simpleResult;
    }

    // 2. 使用 LLM 映射选择
    if (this.llmClient.isAvailable() && options.length > 0) {
      try {
        const mapping = await this.llmClient.mapSelection(options, userMessage);
        return {
          type: IntentTypes.CONVERSATION,
          command: 'select',
          params: {
            choice: mapping.input,
            method: mapping.method
          },
          confidence: 0.9
        };
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 选择映射失败');
      }
    }

    // 3. 降级：规则匹配
    const quickResult = this.quickParse(userMessage);
    if (quickResult && quickResult.type === IntentTypes.CONVERSATION) {
      return quickResult;
    }

    // 4. 默认：直接作为输入
    return {
      type: IntentTypes.CONVERSATION,
      command: 'select',
      params: { choice: userMessage.trim() },
      confidence: 0.7
    };
  }

  /**
   * 获取会话状态
   */
  getSession() {
    return this.session;
  }

  /**
   * 重置会话状态
   */
  resetSession() {
    this.session = new SessionState();
  }
}

// 单例
let instance = null;

export function getIntentParser() {
  if (!instance) {
    instance = new IntentParser();
  }
  return instance;
}

export default IntentParser;
