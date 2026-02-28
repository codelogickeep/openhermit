import { getLLMClient } from '../llm/index.js';
import logger from '../utils/logger.js';
import { TerminalPatterns, extractOptions } from '../formatter/patterns.js';

/**
 * 选择检测器
 * 检测终端输出中的选择提示
 */
class SelectionDetector {
  constructor() {
    this.llmClient = getLLMClient();
    this.lastSelection = null;
  }

  /**
   * 检测选择提示
   * @param {string} terminalOutput - 终端输出
   * @returns {object|null} 选择信息
   */
  async detect(terminalOutput) {
    if (!terminalOutput || terminalOutput.length === 0) {
      return null;
    }

    // 快速规则检测
    const quickResult = this.quickDetect(terminalOutput);
    if (quickResult && quickResult.confidence >= 0.9) {
      this.lastSelection = quickResult;
      return quickResult;
    }

    // LLM 增强检测
    if (this.llmClient.isAvailable()) {
      try {
        const llmResult = await this.llmClient.parseSelection(terminalOutput);
        if (llmResult && llmResult.hasSelection) {
          const result = {
            type: llmResult.selectType,
            options: llmResult.options,
            promptText: llmResult.promptText || '',
            context: llmResult.context || '',
            confidence: 0.95
          };
          this.lastSelection = result;
          return result;
        }
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 选择检测失败');
      }
    }

    // 返回快速检测结果（可能为 null）
    if (quickResult) {
      this.lastSelection = quickResult;
    }
    return quickResult;
  }

  /**
   * 快速规则检测
   * @param {string} text - 终端输出
   * @returns {object|null} 选择信息
   */
  quickDetect(text) {
    // 1. Claude Code 选项格式 [1/N]
    const claudeMatch = text.match(/\[(\d+)\/(\d+)\]/);
    if (claudeMatch) {
      const current = parseInt(claudeMatch[1]);
      const options = extractOptions(text);

      if (options.length > 0) {
        // 标记默认选项
        options.forEach(opt => {
          opt.isDefault = (opt.index === current);
        });

        return {
          type: 'number',
          options,
          promptText: '',
          context: 'Claude Code 选项',
          confidence: 0.95
        };
      }
    }

    // 2. y/n 确认
    const confirmMatch = text.match(/\((y\/n|yes\/no)\)/i);
    if (confirmMatch) {
      return {
        type: 'confirm',
        options: [
          { index: 1, text: 'Yes (同意)', isDefault: false },
          { index: 2, text: 'No (拒绝)', isDefault: false }
        ],
        promptText: confirmMatch[0],
        context: '确认提示',
        confidence: 1.0
      };
    }

    // 3. Allow 工具调用确认
    if (/Allow.*\?/i.test(text) || /allow this/i.test(text)) {
      return {
        type: 'confirm',
        options: [
          { index: 1, text: 'Allow (允许)', isDefault: true },
          { index: 2, text: 'Deny (拒绝)', isDefault: false }
        ],
        promptText: 'Allow this action?',
        context: '工具调用确认',
        confidence: 0.9
      };
    }

    // 4. 数字选项列表（至少2个选项）
    const numberedOptions = extractOptions(text);
    if (numberedOptions.length >= 2) {
      return {
        type: 'number',
        options: numberedOptions,
        promptText: '',
        context: '选项列表',
        confidence: 0.85
      };
    }

    // 5. 方向键选择提示
    if (/use arrow keys|↑↓|select.*option/i.test(text)) {
      const options = extractOptions(text);
      return {
        type: 'arrow',
        options: options.length > 0 ? options : [],
        promptText: '使用方向键选择',
        context: '方向键选择',
        confidence: 0.8
      };
    }

    return null;
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
        selection.options.forEach(opt => {
          output += `${opt.index}️⃣ ${opt.text}\n`;
        });
        output += '\n💡 回复 y(同意) 或 n(拒绝)';
        break;

      case 'arrow':
        output += '⬆️⬇️ 使用方向键选择\n';
        selection.options.forEach(opt => {
          output += `  • ${opt.text}\n`;
        });
        output += '\n💡 回复 /up /down /enter 模拟方向键';
        break;

      default:
        output += '等待输入...\n';
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
