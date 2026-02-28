import { getLLMClient } from '../llm/index.js';
import logger from '../utils/logger.js';
import { TerminalPatterns, detectPatterns } from './patterns.js';

/**
 * Markdown 格式化器
 * 将终端输出转换为 Markdown 格式
 */
class MarkdownFormatter {
  constructor() {
    this.llmClient = getLLMClient();
    this.maxLength = 4000; // 最大输出长度
  }

  /**
   * 格式化终端输出
   * @param {string} terminalOutput - 终端输出
   * @returns {Promise<string>} Markdown 格式输出
   */
  async format(terminalOutput) {
    if (!terminalOutput) return '';

    // 检测模式
    const patterns = detectPatterns(terminalOutput);

    // 极短输出（< 20 字符）：直接返回基本格式化
    if (terminalOutput.length < 20) {
      return this.basicFormat(terminalOutput, patterns);
    }

    // 使用 LLM 格式化（如果可用且输出长度足够）
    if (this.llmClient.isAvailable() && terminalOutput.length >= 50) {
      try {
        const formatted = await this.llmClient.formatOutput(terminalOutput);
        return this.truncate(formatted);
      } catch (error) {
        logger.warn({ error: error.message }, 'LLM 格式化失败，使用基本格式化');
      }
    }

    // 降级：基本格式化
    return this.basicFormat(terminalOutput, patterns);
  }

  /**
   * 基本格式化
   * @param {string} text - 原始文本
   * @param {object} patterns - 检测到的模式
   * @returns {string} 格式化后的文本
   */
  basicFormat(text, patterns = null) {
    if (!patterns) {
      patterns = detectPatterns(text);
    }

    let result = text;

    // 1. 处理 ANSI 转义序列
    result = this.stripAnsi(result);

    // 2. 过滤终端装饰元素（prompt、边框等）
    result = this.filterTerminalDecorations(result);

    // 3. 过滤无意义的内容
    result = this.filterNoise(result);

    // 4. 压缩多余空行
    result = result.replace(/\n{3,}/g, '\n\n');

    // 5. 去除首尾空白
    result = result.trim();

    if (!result) return '';

    // 6. 添加状态图标
    result = this.addStatusIcons(result, patterns);

    // 7. 格式化链接
    if (patterns.hasLinks) {
      result = this.formatLinks(result);
    }

    // 7. 截断过长输出
    return this.truncate(result);
  }

  /**
   * 过滤终端装饰元素
   * @param {string} text - 原始文本
   * @returns {string} 过滤后的文本
   */
  filterTerminalDecorations(text) {
    const lines = text.split('\n');
    const filtered = lines.filter(line => {
      // 过滤 prompt 装饰行（╭─、╰─、│）
      if (/^[╭╰│├┝┥┬┴┼─═]/.test(line)) return false;
      if (/[╮╯]$/.test(line)) return false;

      // 过滤包含路径和时间的 prompt 行
      if (/^[╭╰│].*[~\/].*[·─]/.test(line)) return false;

      // 过滤空 prompt（只有 ❯ 或 $ 或 >）
      if (/^[❯›>$]\s*$/.test(line.trim())) return false;

      // 过滤 zsh prompt 结束符
      if (/^\s*%\s*$/.test(line)) return false;

      // 过滤用户输入回显
      if (/^[❯›>$]\s+\S/.test(line.trim())) return false;

      return true;
    });

    return filtered.join('\n');
  }

  /**
   * 过滤无意义的内容
   * @param {string} text - 原始文本
   * @returns {string} 过滤后的文本
   */
  filterNoise(text) {
    const lines = text.split('\n');
    const filtered = lines.filter(line => {
      const trimmed = line.trim();

      // 过滤空行
      if (!trimmed) return true; // 保留空行用于后续压缩

      // 过滤不完整的 file:// URL（被截断的）
      if (/^[a-z]{1,3}le:\/\//i.test(trimmed)) return false;
      if (/ile:\/\/|^le:\/\//i.test(trimmed)) return false;

      // 过滤纯路径输出（没有实际内容）
      if (/^\/[\w\-\.\/\s]+$/m.test(trimmed) && trimmed.length < 100) {
        // 保留包含实际内容的路径
        if (!trimmed.includes(' ') && !trimmed.includes(':')) return false;
      }

      // 过滤主机名相关的无意义输出
      if (/^[\w\-\.]+\.local\/|^[\w\-]+s-MacBook/i.test(trimmed)) return false;

      // 过滤纯 ANSI 控制字符残留
      if (/^[\x00-\x1f\x7f]+$/.test(trimmed)) return false;

      return true;
    });

    return filtered.join('\n');
  }

  /**
   * 去除 ANSI 转义序列
   * @param {string} text - 原始文本
   * @returns {string} 清理后的文本
   */
  stripAnsi(text) {
    // 去除 ANSI 转义序列
    return text.replace(TerminalPatterns.ansi.escape, '');
  }

  /**
   * 添加状态图标
   * @param {string} text - 原始文本
   * @param {object} patterns - 检测到的模式
   * @returns {string} 添加图标后的文本
   */
  addStatusIcons(text, patterns) {
    let result = text;
    const lines = result.split('\n');

    const formattedLines = lines.map(line => {
      // 如果已经有图标，跳过
      if (/^[❌✅⚠️]/.test(line.trim())) {
        return line;
      }
      // 检测错误行
      if (TerminalPatterns.status.error.test(line)) {
        return `❌ ${line}`;
      }
      // 检测成功行
      if (TerminalPatterns.status.success.test(line)) {
        return `✅ ${line}`;
      }
      // 检测警告行
      if (TerminalPatterns.status.warning.test(line)) {
        return `⚠️ ${line}`;
      }
      return line;
    });

    return formattedLines.join('\n');
  }

  /**
   * 格式化链接
   * @param {string} text - 原始文本
   * @returns {string} 格式化后的文本
   */
  formatLinks(text) {
    return text.replace(TerminalPatterns.link, '[$&]($&)');
  }

  /**
   * 截断过长输出
   * @param {string} text - 原始文本
   * @returns {string} 截断后的文本
   */
  truncate(text) {
    if (text.length <= this.maxLength) {
      return text;
    }

    const truncated = text.slice(0, this.maxLength);
    const lastNewline = truncated.lastIndexOf('\n');

    return truncated.slice(0, lastNewline) +
           '\n\n... (输出已截断)';
  }

  /**
   * 格式化代码块
   * @param {string} code - 代码内容
   * @param {string} language - 语言
   * @returns {string} Markdown 代码块
   */
  formatCodeBlock(code, language = '') {
    return '```' + language + '\n' + code + '\n```\n';
  }

  /**
   * 格式化表格
   * @param {string} text - 包含表格的文本
   * @returns {string} Markdown 表格
   */
  formatTable(text) {
    const lines = text.split('\n');
    const tableLines = [];
    let inTable = false;

    for (const line of lines) {
      if (TerminalPatterns.table.row.test(line)) {
        if (!inTable) {
          inTable = true;
        }
        // 移除首尾的 |
        const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        tableLines.push('| ' + cells.join(' | ') + ' |');
      } else if (inTable && TerminalPatterns.table.separator.test(line)) {
        // 添加 Markdown 表格分隔符
        const cellCount = tableLines[tableLines.length - 1].split('|').length - 2;
        tableLines.push('| ' + Array(cellCount).fill('---').join(' | ') + ' |');
      } else if (inTable) {
        inTable = false;
      }
    }

    return tableLines.join('\n');
  }
}

// 单例
let instance = null;

export function getMarkdownFormatter() {
  if (!instance) {
    instance = new MarkdownFormatter();
  }
  return instance;
}

export default MarkdownFormatter;
