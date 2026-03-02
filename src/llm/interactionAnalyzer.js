/**
 * LLM 交互分析器
 * 用于分析非标准交互提示，提取关键信息，并在用户回复时带上上下文解析
 */

import { getLLMClient } from './client.js';
import { getInteractionContext } from './interactionContext.js';
import logger from '../utils/logger.js';

/**
 * LLM Prompt 模板
 */
const AnalyzePrompts = {
  /**
   * 终端输出分析 Prompt
   */
  analyzeOutput: `你是一个终端交互分析助手。分析以下终端输出，提取关键信息。

【终端输出】
"""
{{terminalOutput}}
"""

返回 JSON 格式：
{
  "type": "text_input | selection | confirmation",
  "context": {
    "question": "提取主要问题，简洁明了（不超过100字）",
    "examples": ["提取的示例列表"],
    "additionalInfo": "其他关键上下文（可选）"
  },
  "suggestedInput": "建议的输入（可选）"
}

要求：
1. question 要简洁，只保留核心问题
2. examples 只提取真正的示例，没有则返回空数组
3. additionalInfo 只保留对用户有用的信息
4. 只返回 JSON，不要其他内容`,

  /**
   * 用户回复解析 Prompt
   */
  parseReply: `你是一个用户意图解析助手。

【之前的终端输出】
"""
{{terminalOutput}}
"""

【分析的问题】
{{previousAnalysis}}

【用户的回复】
{{userReply}}

请将用户回复转换为终端输入。

返回 JSON 格式：
{
  "understood": true,
  "input": "要发送到终端的具体内容",
  "feedback": "给用户的简短反馈（可选）"
}

要求：
1. 如果用户回复数字，原样保留
2. 如果用户回复文本描述，转换为合适的输入
3. 模糊回复时，根据上下文推断
4. 只返回 JSON`
};

/**
 * LLM 交互分析器
 */
class LLMInteractionAnalyzer {
  constructor() {
    this.llmClient = getLLMClient();
    this.context = getInteractionContext();
  }

  /**
   * 分析终端输出（非标准交互）
   * @param {string} terminalOutput - 终端输出
   * @returns {Promise<object>} 分析结果
   */
  async analyze(terminalOutput) {
    // 尝试 LLM 分析
    if (this.llmClient.isAvailable()) {
      try {
        const prompt = AnalyzePrompts.analyzeOutput.replace('{{terminalOutput}}', terminalOutput);
        const response = await this.llmClient.chat(prompt, {
          temperature: 0.2,
          maxTokens: 500,
          timeout: 20000,
          systemPrompt: '你是一个终端交互分析助手，只返回 JSON 格式结果。'
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          logger.debug({ analysis }, '🤖 LLM 分析终端输出成功');
          return analysis;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 分析终端输出失败，使用规则降级');
      }
    }

    // 降级：规则提取
    return this.fallbackAnalyze(terminalOutput);
  }

  /**
   * 降级：规则提取分析
   * @param {string} terminalOutput - 终端输出
   * @returns {object} 分析结果
   */
  fallbackAnalyze(terminalOutput) {
    // 提取最后一句问句
    const questions = terminalOutput.match(/([^。！？\n]*[？?])/g);
    const question = questions?.[questions.length - 1] || '请输入您的指令';

    // 提取示例（以 "-" 开头的行，或带引号的示例）
    const examples = [];
    const exampleMatches = terminalOutput.matchAll(/^-\s*[""']?([^""'\n]+)[""']?$/gm);
    for (const match of exampleMatches) {
      const text = match[1].trim();
      if (text.length > 2) {
        examples.push(text);
      }
    }

    return {
      type: 'text_input',
      context: {
        question,
        examples,
        additionalInfo: ''
      }
    };
  }

  /**
   * 解析用户回复（带上下文）
   * @param {string} userReply - 用户回复
   * @returns {Promise<object>} 解析结果
   */
  async parseUserReply(userReply) {
    const interactionContext = this.context.getContext();

    // 没有上下文，直接返回用户输入
    if (!interactionContext) {
      return {
        understood: true,
        input: userReply.trim()
      };
    }

    // 有上下文，用 LLM 解析
    if (this.llmClient.isAvailable()) {
      try {
        const prompt = AnalyzePrompts.parseReply
          .replace('{{terminalOutput}}', interactionContext.terminalOutput)
          .replace('{{previousAnalysis}}', JSON.stringify(interactionContext.analysis))
          .replace('{{userReply}}', userReply);

        const response = await this.llmClient.chat(prompt, {
          temperature: 0.2,
          maxTokens: 300,
          timeout: 20000,
          systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          logger.debug({ result }, '🤖 LLM 解析用户回复成功');
          return result;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 解析用户回复失败，直接使用原始输入');
      }
    }

    // 降级：直接返回用户输入
    return {
      understood: true,
      input: userReply.trim()
    };
  }

  /**
   * 生成钉钉消息
   * @param {object} analysis - 分析结果
   * @returns {string} 格式化的消息
   */
  formatMessage(analysis) {
    const { type, context } = analysis;
    const { question, examples, additionalInfo } = context || {};

    let msg = '';

    switch (type) {
      case 'confirmation':
        msg = '## ⚠️ 请确认\n\n';
        msg += `**${question || '是否继续？'}**\n\n`;
        msg += '请回复 **y** (同意) 或 **n** (拒绝)';
        break;

      case 'selection':
        msg = '## 🤔 请选择\n\n';
        if (question) {
          msg += `**${question}**\n\n`;
        }
        if (examples && examples.length > 0) {
          msg += '**选项：**\n';
          examples.forEach((opt, idx) => {
            msg += `${idx + 1}. ${opt}\n`;
          });
          msg += '\n请回复对应的数字。';
        }
        break;

      case 'text_input':
      default:
        msg = '## ✍️ 等待输入\n\n';
        if (question) {
          msg += `**Claude 的问题：**\n${question}\n\n`;
        }
        if (examples && examples.length > 0) {
          msg += '**示例：**\n';
          examples.forEach((ex, idx) => {
            msg += `${idx + 1}. ${ex}\n`;
          });
          msg += '\n';
        }
        if (additionalInfo) {
          msg += `**上下文：** ${additionalInfo}\n\n`;
        }
        msg += '请直接回复您的任务描述。';
        break;
    }

    return msg;
  }

  /**
   * 分析并发送消息到钉钉
   * @param {string} terminalOutput - 终端输出
   * @param {function} sendFn - 发送函数
   * @returns {Promise<object>} 分析结果
   */
  async analyzeAndSend(terminalOutput, sendFn) {
    // 分析终端输出
    const analysis = await this.analyze(terminalOutput);

    // 保存上下文
    const contextId = Date.now().toString();
    this.context.setContext(contextId, analysis, terminalOutput);

    // 生成消息
    const message = this.formatMessage(analysis);

    // 发送
    if (sendFn) {
      sendFn(message);
    }

    logger.info({ type: analysis.type, contextId }, '📤 发送交互提示到钉钉');

    return analysis;
  }
}

// 单例
let instance = null;

export function getInteractionAnalyzer() {
  if (!instance) {
    instance = new LLMInteractionAnalyzer();
  }
  return instance;
}

export default LLMInteractionAnalyzer;
