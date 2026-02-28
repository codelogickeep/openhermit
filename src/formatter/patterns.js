/**
 * 终端模式识别
 * 用于识别终端输出中的各种格式模式
 */

/**
 * 终端模式定义
 */
export const TerminalPatterns = {
  // 代码块模式
  codeBlock: {
    // 缩进代码块
    indented: /^( {4}|\t)/m,
    // 围栏代码块
    fenced: /^```[\w]*$/m,
  },

  // 表格模式
  table: {
    // 分隔行 (|---|---|)
    separator: /^\|?[\s-:|]+\|?$/m,
    // 表格行
    row: /^\|?.+\|.*$/m,
  },

  // 列表模式
  list: {
    // 无序列表
    unordered: /^[ \t]*[-*+][ \t]+/m,
    // 有序列表
    ordered: /^[ \t]*\d+\.[ \t]+/m,
  },

  // 标题模式
  heading: {
    // 下划线标题
    underline: /^(.+)\n[=-]+$/m,
    // Markdown 标题
    markdown: /^#{1,6}[ \t]+/m,
  },

  // 链接模式
  link: /https?:\/\/[^\s<>\[\]"']+/g,

  // 选择模式
  selection: {
    // Claude 选项 [1/N]
    claude: /\[(\d+)\/(\d+)\]/,
    // 数字选项
    numbered: /^[ \t]*(\d+)[.)][ \t]+(.+)$/m,
    // y/n 确认
    confirm: /\(y\/n\)|\(yes\/no\)/i,
  },

  // ANSI 颜色模式
  ansi: {
    // ANSI 转义序列
    escape: /\x1b\[[0-9;]*[a-zA-Z]/g,
    // 颜色码
    color: /\x1b\[(3[0-7]|9[0-7]|4[0-7]|10[0-7])m/g,
  },

  // 进度指示
  progress: {
    // 转圈动画
    spinner: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠎⠜⠷⠯⠿]/,
    // 进度条
    bar: /\[=+\s*-*\]/,
    // 百分比
    percent: /\d+%/,
  },

  // 错误/警告模式
  status: {
    error: /\b(error|failed|failure|exception)\b/i,
    warning: /\b(warning|warn)\b/i,
    success: /\b(success|completed|done|ok)\b/i,
  }
};

/**
 * 检测文本中的模式
 * @param {string} text - 终端输出文本
 * @returns {object} 检测到的模式
 */
export function detectPatterns(text) {
  const patterns = {
    hasCodeBlock: TerminalPatterns.codeBlock.indented.test(text) ||
                  TerminalPatterns.codeBlock.fenced.test(text),
    hasTable: TerminalPatterns.table.separator.test(text),
    hasList: TerminalPatterns.list.unordered.test(text) ||
             TerminalPatterns.list.ordered.test(text),
    hasHeading: TerminalPatterns.heading.underline.test(text) ||
                TerminalPatterns.heading.markdown.test(text),
    hasLinks: TerminalPatterns.link.test(text),
    hasSelection: TerminalPatterns.selection.claude.test(text) ||
                  TerminalPatterns.selection.confirm.test(text),
    hasAnsi: TerminalPatterns.ansi.escape.test(text),
    hasProgress: TerminalPatterns.progress.spinner.test(text) ||
                 TerminalPatterns.progress.bar.test(text),
    hasError: TerminalPatterns.status.error.test(text),
    hasWarning: TerminalPatterns.status.warning.test(text),
    hasSuccess: TerminalPatterns.status.success.test(text),
  };

  // 计算复杂度
  const complexity = Object.values(patterns).filter(Boolean).length;
  patterns.complexity = complexity;

  return patterns;
}

/**
 * 提取代码块
 * @param {string} text - 终端输出
 * @returns {array} 代码块数组
 */
export function extractCodeBlocks(text) {
  const blocks = [];
  const lines = text.split('\n');
  let currentBlock = [];
  let inBlock = false;
  let blockLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查围栏代码块开始
    const fenceMatch = line.match(/^```(\w*)$/);
    if (fenceMatch && !inBlock) {
      inBlock = true;
      blockLang = fenceMatch[1] || '';
      currentBlock = [];
      continue;
    }

    // 检查围栏代码块结束
    if (line === '```' && inBlock) {
      blocks.push({
        language: blockLang,
        code: currentBlock.join('\n')
      });
      inBlock = false;
      currentBlock = [];
      blockLang = '';
      continue;
    }

    // 收集代码块内容
    if (inBlock) {
      currentBlock.push(line);
    }
  }

  return blocks;
}

/**
 * 提取选项列表
 * @param {string} text - 终端输出
 * @returns {array} 选项数组
 */
export function extractOptions(text) {
  const options = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const match = line.match(TerminalPatterns.selection.numbered);
    if (match) {
      options.push({
        index: parseInt(match[1]),
        text: match[2].trim()
      });
    }
  }

  return options;
}

export default {
  TerminalPatterns,
  detectPatterns,
  extractCodeBlocks,
  extractOptions
};
