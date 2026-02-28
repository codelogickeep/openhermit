import axios from 'axios';
import { getDashScopeApiKey, getDashScopeModel } from '../config/index.js';
import logger from '../utils/logger.js';
import { Prompts } from './prompts.js';

/**
 * 阿里云百炼（DashScope）API 客户端
 * 使用 OpenAI 兼容模式调用通义千问模型
 */
class LLMClient {
  constructor() {
    this.apiKey = null;
    this.model = null;
    this.baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.initialized = false;
    this.maxRetries = 2;  // 最大重试次数
    this.retryDelay = 1000;  // 重试延迟（毫秒）
  }

  /**
   * 初始化客户端
   */
  init() {
    if (this.initialized) return;

    try {
      this.apiKey = getDashScopeApiKey();
      this.model = getDashScopeModel();
      this.initialized = true;
      logger.info({ model: this.model }, 'LLM 客户端初始化成功');
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 客户端初始化失败，智能功能将不可用');
      this.initialized = false;
    }
  }

  /**
   * 检查客户端是否可用
   */
  isAvailable() {
    if (!this.initialized) {
      this.init();
    }
    return this.initialized && this.apiKey;
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 调用百炼 API（带重试）
   * @param {string} prompt - 用户提示
   * @param {object} options - 可选参数
   * @returns {Promise<string>} 模型响应
   */
  async chat(prompt, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('LLM 客户端未初始化或 API Key 未配置');
    }

    const {
      temperature = 0.3,
      maxTokens = 1000,
      systemPrompt = '你是一个有帮助的助手。',
      timeout = 30000  // 默认 30 秒超时
    } = options;

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          logger.info({ attempt, maxRetries: this.maxRetries }, 'LLM API 重试中...');
          await this.sleep(this.retryDelay * attempt);
        }

        logger.debug({ model: this.model, promptLength: prompt.length, attempt }, '调用 LLM API');

        const response = await axios({
          method: 'POST',
          url: `${this.baseUrl}/chat/completions`,
          data: {
            model: this.model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens
          },
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout,
          proxy: false
        });

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('API 返回空响应');
        }

        if (attempt > 0) {
          logger.info({ attempt }, 'LLM API 重试成功');
        }

        return content;
      } catch (error) {
        lastError = error;
        const errorMsg = error.response?.data?.error?.message || error.message;

        // 超时或网络错误，尝试重试
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || errorMsg.includes('timeout')) {
          logger.warn({ attempt, error: errorMsg }, 'LLM API 超时，准备重试');
          continue;
        }

        // 其他错误（如认证错误），不重试
        logger.error({ error: errorMsg }, 'LLM API 调用失败');
        throw new Error(`LLM API 调用失败: ${errorMsg}`);
      }
    }

    // 所有重试都失败
    logger.error({ error: lastError?.message }, 'LLM API 重试耗尽');
    throw new Error(`LLM API 调用失败: ${lastError?.message}`);
  }

  /**
   * 解析用户意图
   * @param {string} userMessage - 用户消息
   * @param {object} context - 上下文信息
   * @returns {Promise<object>} 意图对象
   */
  async parseIntent(userMessage, context = {}) {
    if (!this.isAvailable()) {
      // 降级：简单的规则匹配
      return this.fallbackIntentParse(userMessage);
    }

    try {
      const prompt = Prompts.parseIntent.replace('{{userMessage}}', userMessage);
      const response = await this.chat(prompt, {
        temperature: 0.1,
        maxTokens: 500,
        systemPrompt: '你是一个精确的命令解析器，只返回 JSON 格式结果，不要添加任何额外说明。'
      });

      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const intent = JSON.parse(jsonMatch[0]);
        logger.debug({ intent }, '意图解析成功');
        return intent;
      }

      throw new Error('无法从响应中提取 JSON');
    } catch (error) {
      logger.warn({ error: error.message, userMessage }, 'LLM 意图解析失败，使用规则降级');
      return this.fallbackIntentParse(userMessage);
    }
  }

  /**
   * 降级：规则匹配意图解析
   * @param {string} userMessage - 用户消息
   * @returns {object} 意图对象
   */
  fallbackIntentParse(userMessage) {
    const trimmed = userMessage.trim();

    // 内置命令
    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      if (['/cd', '/ls', '/restart'].includes(cmd)) {
        return {
          type: 'built_in',
          command: cmd,
          params: { path: parts.slice(1).join(' ') },
          confidence: 1.0
        };
      }
    }

    // y/n 确认
    const lower = trimmed.toLowerCase();
    if (lower === 'y' || lower === 'yes' || lower === 'n' || lower === 'no') {
      return {
        type: 'conversation',
        command: 'confirm',
        params: { value: lower === 'y' || lower === 'yes' ? 'y' : 'n' },
        confidence: 1.0
      };
    }

    // 数字选择
    if (/^\d+$/.test(trimmed)) {
      return {
        type: 'conversation',
        command: 'select',
        params: { choice: parseInt(trimmed) },
        confidence: 0.9
      };
    }

    // 常见 shell 命令
    const shellCommands = ['ls', 'cd', 'cat', 'grep', 'find', 'pwd', 'echo', 'mkdir', 'rm', 'cp', 'mv', 'git'];
    const firstWord = trimmed.split(/\s+/)[0];
    if (shellCommands.includes(firstWord)) {
      return {
        type: 'shell_command',
        command: trimmed,
        params: {},
        confidence: 0.8
      };
    }

    // 默认：Claude 命令
    return {
      type: 'claude_command',
      command: trimmed,
      params: {},
      confidence: 0.7
    };
  }

  /**
   * 格式化终端输出为 Markdown
   * @param {string} terminalOutput - 终端输出
   * @returns {Promise<string>} Markdown 格式输出
   */
  async formatOutput(terminalOutput) {
    if (!this.isAvailable()) {
      // 降级：简单的格式化
      return this.fallbackFormat(terminalOutput);
    }

    // 如果输出很短，直接返回
    if (terminalOutput.length < 100) {
      return this.fallbackFormat(terminalOutput);
    }

    try {
      const prompt = Prompts.formatOutput.replace('{{terminalOutput}}', terminalOutput);
      const response = await this.chat(prompt, {
        temperature: 0.2,
        maxTokens: 3000,
        timeout: 45000,  // 格式化可能需要更长时间
        systemPrompt: '你是一个终端输出格式化助手，将输出转换为 Markdown 格式。保持信息完整，不要添加额外说明。'
      });

      return response.trim();
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 输出格式化失败，使用规则降级');
      return this.fallbackFormat(terminalOutput);
    }
  }

  /**
   * 降级：简单的格式化
   * @param {string} text - 原始文本
   * @returns {string} 格式化后的文本
   */
  fallbackFormat(text) {
    // 基本的格式化处理
    let result = text;

    // 压缩多余空行
    result = result.replace(/\n{3,}/g, '\n\n');

    // 识别代码块（缩进 4 空格或 tab）
    // 这里简单处理，不做复杂的代码块检测

    return result;
  }

  /**
   * 解析选择提示
   * @param {string} terminalOutput - 终端输出
   * @returns {Promise<object|null>} 选择信息
   */
  async parseSelection(terminalOutput) {
    if (!this.isAvailable()) {
      return this.fallbackParseSelection(terminalOutput);
    }

    try {
      const prompt = Prompts.parseSelection.replace('{{terminalOutput}}', terminalOutput);
      const response = await this.chat(prompt, {
        temperature: 0.1,
        maxTokens: 1000,
        systemPrompt: '你是一个选择提示解析器，只返回 JSON 格式结果。'
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        if (result.hasSelection) {
          logger.debug({ selection: result }, '选择提示解析成功');
          return result;
        }
      }

      return null;
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 选择解析失败，使用规则降级');
      return this.fallbackParseSelection(terminalOutput);
    }
  }

  /**
   * 降级：规则匹配选择解析
   * @param {string} terminalOutput - 终端输出
   * @returns {object|null} 选择信息
   */
  fallbackParseSelection(terminalOutput) {
    // Claude Code 选项格式: [1/N]
    const claudeMatch = terminalOutput.match(/\[(\d+)\/(\d+)\]/);
    if (claudeMatch) {
      const current = parseInt(claudeMatch[1]);
      const total = parseInt(claudeMatch[2]);
      // 提取选项文本
      const lines = terminalOutput.split('\n');
      const options = [];
      lines.forEach((line, idx) => {
        const optMatch = line.match(/^\s*(\d+)\.\s*(.+)$/);
        if (optMatch) {
          options.push({
            index: parseInt(optMatch[1]),
            text: optMatch[2].trim(),
            isDefault: parseInt(optMatch[1]) === current
          });
        }
      });

      if (options.length > 0) {
        return {
          hasSelection: true,
          options,
          selectType: 'number',
          context: 'Claude Code 选项'
        };
      }
    }

    // y/n 确认
    if (/\(y\/n\)/i.test(terminalOutput) || /\(yes\/no\)/i.test(terminalOutput)) {
      return {
        hasSelection: true,
        options: [
          { index: 1, text: 'Yes', isDefault: false },
          { index: 2, text: 'No', isDefault: false }
        ],
        selectType: 'confirm',
        context: '确认提示'
      };
    }

    // 数字选项列表
    const numberedOptions = [];
    const lines = terminalOutput.split('\n');
    lines.forEach(line => {
      const match = line.match(/^\s*(\d+)\.\s+(.+)$/);
      if (match) {
        numberedOptions.push({
          index: parseInt(match[1]),
          text: match[2].trim(),
          isDefault: false
        });
      }
    });

    if (numberedOptions.length >= 2) {
      return {
        hasSelection: true,
        options: numberedOptions,
        selectType: 'number',
        context: '选项列表'
      };
    }

    return null;
  }

  /**
   * 映射用户选择到终端输入
   * @param {array} options - 选项列表
   * @param {string} userInput - 用户输入
   * @returns {Promise<object>} 映射结果
   */
  async mapSelection(options, userInput) {
    if (!this.isAvailable()) {
      return this.fallbackMapSelection(options, userInput);
    }

    try {
      const prompt = Prompts.mapSelection
        .replace('{{options}}', JSON.stringify(options))
        .replace('{{userInput}}', userInput);

      const response = await this.chat(prompt, {
        temperature: 0.1,
        maxTokens: 200,
        systemPrompt: '你是一个选择映射器，只返回 JSON 格式结果。'
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return this.fallbackMapSelection(options, userInput);
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 选择映射失败，使用规则降级');
      return this.fallbackMapSelection(options, userInput);
    }
  }

  /**
   * 降级：规则匹配选择映射
   * @param {array} options - 选项列表
   * @param {string} userInput - 用户输入
   * @returns {object} 映射结果
   */
  fallbackMapSelection(options, userInput) {
    const trimmed = userInput.trim();

    // 直接数字
    if (/^\d+$/.test(trimmed)) {
      return { input: trimmed, method: 'number' };
    }

    // 中文数字映射
    const chineseNumbers = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '第一个': 1, '第二个': 2, '第三个': 3 };
    if (chineseNumbers[trimmed]) {
      return { input: String(chineseNumbers[trimmed]), method: 'number' };
    }

    // y/n 确认
    const lower = trimmed.toLowerCase();
    if (lower === 'y' || lower === 'yes' || lower === '是' || lower === '同意') {
      return { input: 'y', method: 'text' };
    }
    if (lower === 'n' || lower === 'no' || lower === '否' || lower === '拒绝') {
      return { input: 'n', method: 'text' };
    }

    // 文本匹配选项
    const lowerInput = lower;
    for (const opt of options) {
      if (opt.text.toLowerCase().includes(lowerInput) || lowerInput.includes(opt.text.toLowerCase())) {
        return { input: String(opt.index), method: 'number' };
      }
    }

    // 默认：直接输入
    return { input: trimmed, method: 'text' };
  }

  /**
   * 智能上下文处理
   * 结合终端输出和用户输入，智能判断如何处理
   * @param {string} terminalOutput - 最近的终端输出
   * @param {string} userInput - 用户输入
   * @returns {Promise<object>} 处理结果
   */
  async contextProcess(terminalOutput, userInput) {
    if (!this.isAvailable()) {
      return this.fallbackContextProcess(terminalOutput, userInput);
    }

    try {
      // 截取最近的终端输出（最多 2000 字符）
      const recentOutput = terminalOutput.slice(-2000);

      const prompt = Prompts.contextProcess
        .replace('{{terminalOutput}}', recentOutput)
        .replace('{{userInput}}', userInput);

      const response = await this.chat(prompt, {
        temperature: 0.1,
        maxTokens: 300,
        systemPrompt: '你是一个终端交互助手，只返回 JSON 格式结果。准确分析终端状态和用户意图。最后一句必须是 JSON。'
      });

      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        logger.debug({ result }, '智能上下文处理成功');
        return result;
      }

      throw new Error('无法从响应中提取 JSON');
    } catch (error) {
      logger.warn({ error: error.message }, 'LLM 智能上下文处理失败，使用规则降级');
      return this.fallbackContextProcess(terminalOutput, userInput);
    }
  }

  /**
   * 降级：规则匹配上下文处理
   * @param {string} terminalOutput - 终端输出
   * @param {string} userInput - 用户输入
   * @returns {object} 处理结果
   */
  fallbackContextProcess(terminalOutput, userInput) {
    const trimmed = userInput.trim();
    const lower = trimmed.toLowerCase();

    // 检查终端输出中是否有选择提示
    const hasSelection = /\d+\.\s+.+\n\d+\.\s+/.test(terminalOutput) || /\[.*\]/.test(terminalOutput);
    const hasConfirm = /\(y\/n\)|\(yes\/no\)|\?/i.test(terminalOutput);

    // 如果终端在等待输入
    if (hasSelection || hasConfirm) {
      // 简单数字选择
      if (/^\d+$/.test(trimmed)) {
        return {
          terminalState: 'waiting_input',
          inputType: 'selection',
          action: { type: 'select', value: trimmed },
          confidence: 0.9
        };
      }

      // y/n 确认
      if (lower === 'y' || lower === 'yes' || lower === 'n' || lower === 'no') {
        return {
          terminalState: 'waiting_input',
          inputType: 'confirm',
          action: { type: 'confirm', value: lower === 'y' || lower === 'yes' ? 'y' : 'n' },
          confidence: 0.9
        };
      }

      // 中文选择
      const chineseNumbers = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '第一个': 1, '第二个': 2, '第三个': 3 };
      for (const [key, value] of Object.entries(chineseNumbers)) {
        if (trimmed.includes(key)) {
          return {
            terminalState: 'waiting_input',
            inputType: 'selection',
            action: { type: 'select', value: String(value) },
            confidence: 0.85
          };
        }
      }
    }

    // 默认：直接输入
    return {
      terminalState: 'idle',
      inputType: 'text',
      action: { type: 'write', value: trimmed },
      confidence: 0.7
    };
  }
}

// 单例
let instance = null;

export function getLLMClient() {
  if (!instance) {
    instance = new LLMClient();
  }
  return instance;
}

export default LLMClient;
