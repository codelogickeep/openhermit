import { getLLMClient } from '../llm/index.js';
import logger from '../utils/logger.js';

/**
 * 意图类型枚举
 */
export const IntentTypes = {
  CLAUDE_COMMAND: 'claude_command',   // 需要启动 Claude Code
  SHELL_COMMAND: 'shell_command',     // 直接 shell 命令
  BUILT_IN: 'built_in',               // 内置命令 (/cd, /ls, /restart)
  CONVERSATION: 'conversation'        // 对话交互（选择回复等）
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
    // 1. 如果在等待选择状态，优先处理选择
    if (this.session.isWaitingSelection()) {
      return this.parseSelectionResponse(userMessage);
    }

    // 2. 快速规则匹配（不调用 LLM）
    const quickResult = this.quickParse(userMessage);
    if (quickResult && quickResult.confidence >= 0.95) {
      logger.debug({ intent: quickResult }, '快速规则匹配成功');
      return quickResult;
    }

    // 3. LLM 解析
    try {
      const context = {
        sessionMode: this.session.mode,
        hasSelection: this.session.selectionOptions.length > 0
      };

      const intent = await this.llmClient.parseIntent(userMessage, context);

      // 如果 LLM 返回的结果置信度较低，结合规则结果
      if (quickResult && intent.confidence < quickResult.confidence) {
        return quickResult;
      }

      return intent;
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 解析失败，使用规则结果');
      return quickResult || {
        type: IntentTypes.CLAUDE_COMMAND,
        command: userMessage,
        params: {},
        confidence: 0.5
      };
    }
  }

  /**
   * 快速规则匹配
   * @param {string} userMessage - 用户消息
   * @returns {object|null} 意图对象或 null
   */
  quickParse(userMessage) {
    const trimmed = userMessage.trim();

    // 空消息
    if (!trimmed) {
      return null;
    }

    // 内置命令
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === '/cd') {
        return {
          type: IntentTypes.BUILT_IN,
          command: '/cd',
          params: { path: parts.slice(1).join(' ') || '' },
          confidence: 1.0
        };
      }

      if (cmd === '/ls') {
        return {
          type: IntentTypes.BUILT_IN,
          command: '/ls',
          params: {},
          confidence: 1.0
        };
      }

      if (cmd === '/restart') {
        return {
          type: IntentTypes.BUILT_IN,
          command: '/restart',
          params: {},
          confidence: 1.0
        };
      }

      // 未知的内置命令
      return {
        type: IntentTypes.BUILT_IN,
        command: cmd,
        params: { raw: trimmed },
        confidence: 0.8
      };
    }

    // y/n 确认
    const lower = trimmed.toLowerCase();
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

    // 常见 shell 命令（精确匹配）
    const exactShellCommands = ['ls', 'pwd', 'clear', 'exit', 'date', 'whoami'];
    if (exactShellCommands.includes(trimmed)) {
      return {
        type: IntentTypes.SHELL_COMMAND,
        command: trimmed,
        params: {},
        confidence: 0.95
      };
    }

    // 带参数的 shell 命令
    const shellPrefixes = ['ls ', 'cd ', 'cat ', 'grep ', 'find ', 'mkdir ', 'rm ', 'cp ', 'mv ', 'git ', 'npm ', 'node '];
    for (const prefix of shellPrefixes) {
      if (trimmed.startsWith(prefix)) {
        return {
          type: IntentTypes.SHELL_COMMAND,
          command: trimmed,
          params: {},
          confidence: 0.9
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
    const lowerTrimmed = lower;
    for (const keyword of engDevKeywords) {
      if (lowerTrimmed.includes(keyword)) {
        return {
          type: IntentTypes.CLAUDE_COMMAND,
          command: trimmed,
          params: {},
          confidence: 0.85
        };
      }
    }

    // 默认：如果当前 Claude 活跃，作为对话；否则作为 Claude 命令
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

    // 使用 LLM 映射选择
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
        logger.warn({ error: error.message }, '选择映射失败');
      }
    }

    // 降级：规则匹配
    const quickResult = this.quickParse(userMessage);
    if (quickResult && quickResult.type === IntentTypes.CONVERSATION) {
      return quickResult;
    }

    // 默认：直接作为输入
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
