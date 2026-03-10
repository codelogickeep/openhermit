/**
 * LLM 交互分析器
 * 用于分析非标准交互提示，提取关键信息，并在用户回复时带上上下文解析
 */

import { getLLMClient } from './client.js';
import { getInteractionContext } from './interactionContext.js';
import { InteractionPrompts } from './prompts/index.js';
import logger from '../utils/logger.js';

/**
 * LLM 交互分析器
 */
class LLMInteractionAnalyzer {
  constructor() {
    this.llmClient = getLLMClient();
    this.context = getInteractionContext();
  }

  /**
   * 分析终端输出
   * @param {string} terminalOutput - 终端输出
   * @returns {Promise<object>} 分析结果
   */
  async analyze(terminalOutput) {
    // 尝试 LLM 分析
    if (this.llmClient.isAvailable()) {
      try {
        const prompt = InteractionPrompts.analyzeOutput.replace('{{terminalOutput}}', terminalOutput);

        // 打印发送给 LLM 的内容
        logger.info({
          terminalOutputLength: terminalOutput.length,
          terminalOutputPreview: terminalOutput.slice(-500)
        }, '📤 发送给 LLM 分析的内容');

        const response = await this.llmClient.chat(prompt, {
          temperature: 0.2,
          maxTokens: 500,
          timeout: 20000,
          systemPrompt: '你是一个终端交互分析助手，只返回 JSON 格式结果。'
        });

        // 打印 LLM 返回的原始响应
        logger.info({ response }, '📥 LLM 返回的原始响应');

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          // 确保 needsInteraction 有默认值
          if (analysis.needsInteraction === undefined) {
            analysis.needsInteraction = analysis.type !== 'none';
          }
          logger.info({ analysis }, '✅ LLM 分析结果');
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
    // 检测是否有编号选项
    const optionMatches = [...terminalOutput.matchAll(/^\s*(\d+)[.)\]]\s+(.+)$/gm)];
    const options = optionMatches.slice(0, 10).map(m => m[2].trim());

    // 检测 y/n 确认
    const isConfirmation = /\(y\/n\)|\[y\/n\]/i.test(terminalOutput);

    // 提取最后一句问句
    const questions = terminalOutput.match(/([^。！？\n]*[？?])/g);
    const question = questions?.[questions.length - 1] || '请输入您的指令';

    if (isConfirmation) {
      return {
        needsInteraction: true,
        type: 'confirmation',
        context: {
          question,
          options: [],
          additionalInfo: ''
        }
      };
    }

    if (options.length >= 2) {
      return {
        needsInteraction: true,
        type: 'selection',
        context: {
          question,
          options,
          additionalInfo: ''
        }
      };
    }

    // 默认：文本输入
    return {
      needsInteraction: true,
      type: 'text_input',
      context: {
        question,
        options: [],
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
        input: userReply.trim(),
        selectionType: 'text'
      };
    }

    // 有上下文，用 LLM 解析
    if (this.llmClient.isAvailable()) {
      try {
        const prompt = InteractionPrompts.parseReply
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
          logger.info({ result }, '🤖 LLM 解析用户回复成功');

          // 如果是方向键选择模式，生成正确的输入序列
          if (result.selectionType === 'arrow' && result.arrowCount !== undefined) {
            const arrowCount = result.arrowCount || 0;
            let input = '';
            for (let i = 0; i < arrowCount; i++) {
              input += '\x1b[B';  // 下箭头
            }
            input += '\r';  // 回车确认
            result.input = input;
            result.feedback = result.feedback || `已选择第 ${arrowCount + 1} 个选项`;
          } else if (result.selectionType === 'number' && result.input) {
            // 数字选择模式，确保有回车
            if (!result.input.includes('\r')) {
              result.input = result.input.trim() + '\r';
            }
          }

          return result;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 解析用户回复失败，直接使用原始输入');
      }
    }

    // 降级：直接返回用户输入
    return {
      understood: true,
      input: userReply.trim(),
      selectionType: 'text'
    };
  }

  /**
   * 生成钉钉消息
   * @param {object} analysis - 分析结果
   * @returns {string} 格式化的消息
   */
  formatMessage(analysis) {
    const { type, context } = analysis;
    const { question, options, additionalInfo } = context || {};

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
        if (options && options.length > 0) {
          msg += '**选项：**\n';
          options.forEach((opt, idx) => {
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
        if (options && options.length > 0) {
          msg += '**示例：**\n';
          options.forEach((opt, idx) => {
            msg += `${idx + 1}. ${opt}\n`;
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
