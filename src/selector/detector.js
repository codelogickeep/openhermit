import logger from '../utils/logger.js';

/**
 * 选择检测器
 * 只检测标准交互（y/n 确认、Allow 确认、编号选项）
 * 其他非标准交互由 LLMInteractionAnalyzer 处理
 */
class SelectionDetector {
  constructor() {
    this.lastSelection = null;
  }

  /**
   * 检测是否为标准交互
   * @param {string} terminalOutput - 终端输出
   * @returns {object|null} 检测结果，如果不是标准交互返回 null
   */
  detect(terminalOutput) {
    if (!terminalOutput || terminalOutput.length === 0) {
      return null;
    }

    // 1. y/n 确认 - 必须有明确的 y/n 标记
    if (/\(y\/n\)|\[y\/n\]/i.test(terminalOutput)) {
      this.lastSelection = {
        isStandard: true,
        type: 'confirm',
        promptText: '请确认',
        options: [
          { index: 1, text: 'Yes (同意)', isDefault: false },
          { index: 2, text: 'No (拒绝)', isDefault: false }
        ],
        confidence: 1.0
      };
      return this.lastSelection;
    }

    // 2. Allow 确认 - 工具调用确认
    if (/Allow\s+.*\?\s*$/im.test(terminalOutput)) {
      this.lastSelection = {
        isStandard: true,
        type: 'confirm',
        promptText: 'Allow this action?',
        options: [
          { index: 1, text: 'Allow (允许)', isDefault: true },
          { index: 2, text: 'Deny (拒绝)', isDefault: false }
        ],
        confidence: 1.0
      };
      return this.lastSelection;
    }

    // 3. 编号选项 - 必须有 2 个以上连续编号
    const options = this.extractNumberedOptions(terminalOutput);
    if (options.length >= 2) {
      // 检查是否有 Claude Code 的 [1/N] 标记
      const claudeMatch = terminalOutput.match(/\[(\d+)\/(\d+)\]/);
      if (claudeMatch) {
        const current = parseInt(claudeMatch[1]);
        options.forEach(opt => {
          opt.isDefault = (opt.index === current);
        });
      }

      this.lastSelection = {
        isStandard: true,
        type: 'number',
        options,
        promptText: '',
        confidence: 1.0
      };
      logger.debug({ optionCount: options.length }, '📋 检测到标准编号选项');
      return this.lastSelection;
    }

    // 不是标准交互，返回 null（由 LLM 处理）
    this.lastSelection = null;
    return null;
  }

  /**
   * 提取编号选项
   * @param {string} text - 终端输出
   * @returns {array} 选项数组
   */
  extractNumberedOptions(text) {
    const options = [];
    const lines = text.split('\n');

    for (const line of lines) {
      // 匹配多种编号格式：1. xxx, 1) xxx, 1] xxx
      const match = line.match(/^\s*(\d+)[.)\]]\s+(.+)$/);
      if (match) {
        const num = parseInt(match[1]);
        const text = match[2].trim();
        // 过滤太短的选项（但保留中文短选项）
        if (text.length >= 2 || /[\u4e00-\u9fa5]/.test(text)) {
          options.push({ index: num, text, isDefault: false });
        }
      }
    }

    // 验证是否是连续编号
    if (options.length >= 2) {
      const numbers = [...new Set(options.map(o => o.index))].sort((a, b) => a - b);
      const isConsecutive = numbers.every((n, i) => i === 0 || n - numbers[i - 1] <= 2);
      if (!isConsecutive) {
        return [];
      }
    }

    // 去重
    const seen = new Set();
    return options.filter(opt => {
      if (seen.has(opt.index)) return false;
      seen.add(opt.index);
      return true;
    });
  }

  /**
   * 获取最后一次检测结果
   */
  getLastSelection() {
    return this.lastSelection;
  }

  /**
   * 清除最后一次检测结果
   */
  clearLastSelection() {
    this.lastSelection = null;
  }

  /**
   * 格式化选择提示为用户友好的格式
   * @param {object} selection - 选择信息
   * @returns {string} 格式化后的文本
   */
  formatSelectionPrompt(selection) {
    if (!selection) return '';

    let output = '\n📍 请选择：\n\n';

    switch (selection.type) {
      case 'number':
        selection.options.forEach(opt => {
          const marker = opt.isDefault ? ' ← 默认' : '';
          output += `${opt.index}️⃣ ${opt.text}${marker}\n`;
        });
        output += '\n💡 回复数字或选项名称进行选择';
        break;

      case 'confirm':
        output += '请回复 \x1b[32my\x1b[0m (同意) 或 \x1b[31mn\x1b[0m (拒绝)';
        break;

      default:
        output += '等待输入...';
    }

    return output;
  }
}

// 单例
let instance = null;

export function getSelectionDetector() {
  if (!instance) {
    instance = new SelectionDetector();
  }
  return instance;
}

export default SelectionDetector;
