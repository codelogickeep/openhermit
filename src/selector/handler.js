import { getLLMClient } from '../llm/index.js';
import logger from '../utils/logger.js';

/**
 * 选择处理器
 * 处理用户的选择输入并转换为 PTY 输入
 */
class SelectionHandler {
  constructor() {
    this.llmClient = getLLMClient();
  }

  /**
   * 处理用户选择
   * @param {object} selection - 选择信息（来自 detector）
   * @param {string} userInput - 用户输入
   * @returns {object} 处理结果 { input: string, method: string }
   */
  async handle(selection, userInput) {
    if (!selection) {
      return { input: userInput, method: 'text' };
    }

    const trimmed = userInput.trim();

    // 根据选择类型处理
    switch (selection.type) {
      case 'number':
        return this.handleNumberSelection(selection, trimmed);

      case 'confirm':
        return this.handleConfirmSelection(trimmed);

      case 'arrow':
        return this.handleArrowSelection(selection, trimmed);

      default:
        return { input: trimmed, method: 'text' };
    }
  }

  /**
   * 处理数字选择
   * @param {object} selection - 选择信息
   * @param {string} userInput - 用户输入
   * @returns {object} 处理结果
   */
  async handleNumberSelection(selection, userInput) {
    // 直接数字
    if (/^\d+$/.test(userInput)) {
      const num = parseInt(userInput);
      if (num >= 1 && num <= selection.options.length) {
        return { input: String(num), method: 'number' };
      }
    }

    // 中文数字映射
    const chineseNumbers = {
      '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
      '第一个': 1, '第二个': 2, '第三个': 3, '第四个': 4, '第五个': 5,
      '1': 1, '2': 2, '3': 3, '4': 4, '5': 5
    };

    if (chineseNumbers[userInput]) {
      return { input: String(chineseNumbers[userInput]), method: 'number' };
    }

    // 使用 LLM 进行智能映射
    if (this.llmClient.isAvailable()) {
      try {
        const mapping = await this.llmClient.mapSelection(selection.options, userInput);
        if (mapping && mapping.input) {
          return mapping;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 选择映射失败');
      }
    }

    // 文本匹配选项
    const lowerInput = userInput.toLowerCase();
    for (const opt of selection.options) {
      const optText = opt.text.toLowerCase();
      if (optText.includes(lowerInput) || lowerInput.includes(optText)) {
        return { input: String(opt.index), method: 'number' };
      }
    }

    // 默认：直接输入
    return { input: userInput, method: 'text' };
  }

  /**
   * 处理确认选择
   * @param {string} userInput - 用户输入
   * @returns {object} 处理结果
   */
  handleConfirmSelection(userInput) {
    const lower = userInput.toLowerCase();

    // 肯定
    if (lower === 'y' || lower === 'yes' || lower === '是' || lower === '同意' || lower === '允许' || lower === '1') {
      return { input: 'y', method: 'confirm' };
    }

    // 否定
    if (lower === 'n' || lower === 'no' || lower === '否' || lower === '拒绝' || lower === '2') {
      return { input: 'n', method: 'confirm' };
    }

    // 默认：直接输入
    return { input: lower, method: 'text' };
  }

  /**
   * 处理方向键选择
   * @param {object} selection - 选择信息
   * @param {string} userInput - 用户输入
   * @returns {object} 处理结果
   */
  handleArrowSelection(selection, userInput) {
    const lower = userInput.toLowerCase();

    // 方向键模拟
    if (lower === '/up' || lower === '↑' || lower === '上') {
      return { input: '\x1b[A', method: 'arrow' };
    }
    if (lower === '/down' || lower === '↓' || lower === '下') {
      return { input: '\x1b[B', method: 'arrow' };
    }
    if (lower === '/enter' || lower === '回车' || lower === '确认') {
      return { input: '\r', method: 'arrow' };
    }

    // 数字选择（如果选项有索引）
    if (/^\d+$/.test(userInput)) {
      const targetIndex = parseInt(userInput) - 1;
      const currentIndex = selection.options.findIndex(opt => opt.isDefault);

      if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < selection.options.length) {
        // 计算需要按多少次方向键
        const diff = targetIndex - currentIndex;
        let input = '';

        if (diff > 0) {
          for (let i = 0; i < diff; i++) {
            input += '\x1b[B'; // 下
          }
        } else if (diff < 0) {
          for (let i = 0; i < Math.abs(diff); i++) {
            input += '\x1b[A'; // 上
          }
        }

        input += '\r'; // 回车确认
        return { input, method: 'arrow' };
      }
    }

    // 文本匹配
    const lowerInput = lower;
    for (let i = 0; i < selection.options.length; i++) {
      const optText = selection.options[i].text.toLowerCase();
      if (optText.includes(lowerInput) || lowerInput.includes(optText)) {
        const currentIndex = selection.options.findIndex(opt => opt.isDefault);
        const diff = i - currentIndex;
        let input = '';

        if (diff > 0) {
          for (let j = 0; j < diff; j++) input += '\x1b[B';
        } else if (diff < 0) {
          for (let j = 0; j < Math.abs(diff); j++) input += '\x1b[A';
        }

        input += '\r';
        return { input, method: 'arrow' };
      }
    }

    // 默认：直接输入
    return { input: userInput, method: 'text' };
  }
}

// 单例
let instance = null;

export function getSelectionHandler() {
  if (!instance) {
    instance = new SelectionHandler();
  }
  return instance;
}

export default SelectionHandler;
