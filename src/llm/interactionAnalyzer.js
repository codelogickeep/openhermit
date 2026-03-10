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
   * 提取选项区域（用于调试）
   * @param {string} terminalOutput - 终端输出
   * @returns {string} 选项区域内容
   */
  extractOptionArea(terminalOutput) {
    const lines = terminalOutput.split('\n');
    const optionStartIndex = lines.findIndex(line => /\d+\.\s/.test(line) || /[❯→]/.test(line));
    if (optionStartIndex === -1) return '未找到选项';

    // 提取选项区域前后 10 行
    const start = Math.max(0, optionStartIndex - 2);
    const end = Math.min(lines.length, optionStartIndex + 15);
    return lines.slice(start, end).join('\n');
  }

  /**
   * 执行 steps 数组，生成 PTY 输入
   * @param {Array} steps - 操作步骤数组
   * @returns {string} PTY 输入序列
   */
  executeSteps(steps) {
    let input = '';

    for (const step of steps) {
      switch (step.action) {
        case 'arrow_down':
          // 使用 ?? 而不是 ||，因为 count: 0 是有效值
          const downCount = step.count ?? 1;
          for (let i = 0; i < downCount; i++) {
            input += '\x1b[B';  // 下箭头
          }
          break;
        case 'arrow_up':
          // 使用 ?? 而不是 ||，因为 count: 0 是有效值
          const upCount = step.count ?? 1;
          for (let i = 0; i < upCount; i++) {
            input += '\x1b[A';  // 上箭头
          }
          break;
        case 'type':
          input += step.text || '';
          break;
        case 'enter':
          input += '\r';  // 回车
          break;
        default:
          logger.warn({ action: step.action }, '未知的操作类型');
      }
    }

    return input;
  }

  /**
   * 生成带延迟的 PTY 写入函数序列
   * @param {Array} steps - 操作步骤数组
   * @param {number} delayMs - 每步之间的延迟（毫秒）
   * @returns {Array<{input: string, delay: number}>} 带延迟的写入序列
   */
  generateSteppedInput(steps, delayMs = 50) {
    const sequence = [];

    for (const step of steps) {
      switch (step.action) {
        case 'arrow_down': {
          const count = step.count ?? 1;
          for (let i = 0; i < count; i++) {
            sequence.push({ input: '\x1b[B', delay: delayMs });
          }
          break;
        }
        case 'arrow_up': {
          const count = step.count ?? 1;
          for (let i = 0; i < count; i++) {
            sequence.push({ input: '\x1b[A', delay: delayMs });
          }
          break;
        }
        case 'type':
          sequence.push({ input: step.text || '', delay: delayMs });
          break;
        case 'enter':
          sequence.push({ input: '\r', delay: 0 });  // 最后一步不需要延迟
          break;
        default:
          logger.warn({ action: step.action }, '未知的操作类型');
      }
    }

    return sequence;
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

        // 打印发送给 LLM 的内容（非常详细，用于调试）
        // 找到选项相关的行
        const allLines = terminalOutput.split('\n');
        const optionLines = allLines.filter(line => /[❯→✔]|\d+\.\s/.test(line)).slice(0, 10);

        // ===== 详细调试：打印发送给 LLM 的原始终端输出 =====
        console.log('\n' + '='.repeat(80));
        console.log('📤 完整终端输出（发送给 analyzeOutput LLM):');
        console.log('='.repeat(80));
        console.log(terminalOutput);
        console.log('='.repeat(80));

        logger.info({
          terminalOutputLength: terminalOutput.length,
          terminalOutputPreview: terminalOutput.slice(-500),
          // 打印选项相关的行
          optionLines: optionLines,
          // 打印包含数字的行
          linesWithNumbers: allLines.filter(line => /\d+\./.test(line)).slice(0, 10),
          // 打印包含 ❯ 的行（关键！）
          linesWithArrow: allLines.filter(line => /❯|→/.test(line)).slice(0, 5),
          // 打印选项区域的完整内容
          optionAreaContext: this.extractOptionArea(terminalOutput)
        }, '📤 发送给 LLM 分析的内容（详细调试）');

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

    // 获取之前分析的选择类型
    const previousAnalysis = interactionContext.analysis;
    const selectionType = previousAnalysis?.selectionType || 'text';
    const defaultOptionIndex = previousAnalysis?.defaultOptionIndex || 1;

    // 有上下文，用 LLM 解析
    if (this.llmClient.isAvailable()) {
      try {
        // 打印传给 LLM 的终端输出（用于调试）
        console.log('\n' + '='.repeat(80));
        console.log('📤 parseReply 传给 LLM 的终端输出:');
        console.log('='.repeat(80));
        console.log(interactionContext.terminalOutput);
        console.log('='.repeat(80));
        console.log('📤 用户回复:', userReply);
        console.log('='.repeat(80));

        const prompt = InteractionPrompts.parseReply
          .replace('{{terminalOutput}}', interactionContext.terminalOutput)
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

          console.log('\n' + '='.repeat(80));
          console.log('📥 parseReply LLM 返回结果:');
          console.log(JSON.stringify(result, null, 2));
          console.log('='.repeat(80));

          // 如果 LLM 返回了 steps 数组，根据 steps 生成 PTY 输入
          if (result.steps && Array.isArray(result.steps)) {
            const input = this.executeSteps(result.steps);
            result.input = input;
            result.understood = true;  // 标记为已理解

            console.log('\n📦 steps 执行结果:');
            console.log('steps:', JSON.stringify(result.steps));
            console.log('生成的 PTY 输入:', JSON.stringify(input));

            logger.info({
              steps: result.steps,
              selectionType: result.selectionType,
              defaultOptionIndex: result.defaultOptionIndex,
              targetOption: result.targetOption,
              generatedInput: input
            }, '🤖 LLM 解析用户回复成功（使用 steps）');
          } else {
            // 降级：根据 selectionType 手动计算
            if (result.selectionType === 'arrow' || selectionType === 'arrow') {
              // 方向键选择模式
              const actualDefaultIndex = result.defaultOptionIndex ?? defaultOptionIndex;
              let arrowCount;

              if (result.targetOption !== undefined && actualDefaultIndex !== undefined) {
                arrowCount = result.targetOption - actualDefaultIndex;
              } else if (result.arrowCount !== undefined) {
                arrowCount = result.arrowCount;
              } else {
                const numMatch = userReply.match(/\d+/);
                if (numMatch) {
                  arrowCount = parseInt(numMatch[0]) - actualDefaultIndex;
                } else {
                  arrowCount = 0;
                }
              }

              // 生成方向键序列
              let input = '';
              for (let i = 0; i < arrowCount; i++) {
                input += '\x1b[B';  // 下箭头
              }
              input += '\r';  // 回车确认

              result.input = input;
              result.selectionType = 'arrow';
              result.arrowCount = arrowCount;
              result.defaultOptionIndex = actualDefaultIndex;
              result.feedback = result.feedback || `已选择第 ${arrowCount + actualDefaultIndex} 个选项`;
              result.understood = true;  // 标记为已理解

              logger.info({
                result,
                calculatedArrowCount: arrowCount
              }, '🤖 LLM 解析用户回复成功（降级计算）');
            } else if (result.selectionType === 'number' || selectionType === 'number') {
              result.selectionType = 'number';
              result.input = userReply.trim() + '\r';
              result.understood = true;  // 标记为已理解
            } else if (result.selectionType === 'confirm' || selectionType === 'confirm') {
              result.selectionType = 'confirm';
              const lower = userReply.toLowerCase();
              if (lower === 'y' || lower === 'yes' || lower === '是' || lower === '同意') {
                result.input = 'y\r';
              } else {
                result.input = 'n\r';
              }
              result.understood = true;  // 标记为已理解
            }
          }

          return result;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 解析用户回复失败，直接使用原始输入');
      }
    }

    // 降级：根据 selectionType 处理
    if (selectionType === 'arrow') {
      // 尝试从用户输入中提取数字
      const numMatch = userReply.match(/\d+/);
      if (numMatch) {
        const targetIndex = parseInt(numMatch[0]);
        const arrowCount = targetIndex - defaultOptionIndex;
        let input = '';
        for (let i = 0; i < arrowCount; i++) {
          input += '\x1b[B';
        }
        input += '\r';
        return {
          understood: true,
          input,
          selectionType: 'arrow',
          arrowCount,
          feedback: `已选择第 ${targetIndex} 个选项`
        };
      }
    }

    return {
      understood: true,
      input: userReply.trim() + '\r',
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
