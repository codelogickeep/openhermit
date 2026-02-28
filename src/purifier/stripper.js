import stripAnsi from 'strip-ansi';

/**
 * 终端流净化器
 * 用于去除 ANSI 颜色码、控制字符和加载动画
 */

/**
 * 去除 ANSI 转义码
 * @param {string} data - 原始数据
 * @returns {string} 净化后的数据
 */
export function stripAnsiCodes(data) {
  return stripAnsi(data);
}

/**
 * 过滤控制字符
 * 保留换行符，过滤退格和独立回车符
 * @param {string} data - 原始数据
 * @returns {string} 过滤后的数据
 */
export function filterControlChars(data) {
  let result = data;

  // 过滤退格符
  result = result.replace(/[\b]/g, '');

  // 过滤独立的回车符（不跟着换行符的 \r）
  result = result.replace(/\r(?!\n)/g, '');

  // 过滤 ANSI 光标控制序列
  result = result.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  return result;
}

/**
 * 过滤加载动画（转圈动画等）
 * @param {string} data - 原始数据
 * @returns {string} 过滤后的数据
 */
export function filterLoadingAnimations(data) {
  // 过滤常见的转圈字符
  const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠎', '⠜', '⠷', '⠯', '⠿'];
  let result = data;

  spinnerChars.forEach(char => {
    // 过滤连续出现的转圈符
    result = result.replace(new RegExp(char + '+', 'g'), '');
  });

  // 过滤 loading... 模式
  result = result.replace(/loading\.{3,}/gi, 'loading...');

  // 过滤 [=---] 进度条模式
  result = result.replace(/\[=+\s*-+\]/g, '');

  return result;
}

/**
 * 净化终端流
 * @param {string} data - 原始 PTY 输出
 * @returns {string} 净化后的数据
 */
export function purify(data) {
  if (!data) return '';

  let result = data;

  // 1. 去除 ANSI 颜色码
  result = stripAnsiCodes(result);

  // 2. 过滤控制字符
  result = filterControlChars(result);

  // 3. 过滤加载动画
  result = filterLoadingAnimations(result);

  // 4. 移除多余的空白行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

export default {
  stripAnsiCodes,
  filterControlChars,
  filterLoadingAnimations,
  purify
};
