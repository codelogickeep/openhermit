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

  // 过滤终端焦点事件序列（\x1b[O 失去焦点，\x1b[I 获得焦点）
  result = result.replace(/\x1b\[O/g, '');
  result = result.replace(/\x1b\[I/g, '');

  // 过滤 ANSI 光标控制序列（完整的，带 ESC 前缀）
  result = result.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

  // 过滤 bracketed paste mode 序列 [?2026l 和 [?2026h
  result = result.replace(/\[\?2026[hl]/g, '');

  // 过滤其他 [? 开头的私有模式序列
  result = result.replace(/\[\?[0-9;]*[hl]/g, '');

  // 过滤残留的 CSI 序列（ESC 被过滤后留下的部分，如 [27m, [0m 等）
  result = result.replace(/\[[0-9;]*[A-Za-z]/g, '');

  // 过滤 OSC 序列（操作系统命令，如设置窗口标题 ]0;title）
  result = result.replace(/\x1b\].*?\x07/g, '');
  result = result.replace(/\][0-9]+;[^\x07\n]*/g, '');

  // 过滤字符集选择序列
  result = result.replace(/\x1b\([a-zA-Z0-9]/g, '');
  result = result.replace(/\x1b[()][a-zA-Z0-9]/g, '');

  // 过滤其他 ANSI 控制序列
  result = result.replace(/\x1b[()][a-zA-Z0-9]/g, '');
  result = result.replace(/\x1b[=?].*?[a-zA-Z]/g, '');

  // 过滤单独的 ESC 字符（\x1b）
  result = result.replace(/\x1b/g, '');

  return result;
}

/**
 * 过滤加载动画（转圈动画等）
 * @param {string} data - 原始数据
 * @returns {string} 过滤后的数据
 */
export function filterLoadingAnimations(data) {
  // 过滤常见的转圈字符（Braille patterns）
  const brailleSpinners = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠎', '⠜', '⠷', '⠯', '⠿'];

  // Claude Code 使用的加载动画字符
  const claudeSpinners = ['✽', '✻', '✶', '✳', '✢', '·', '✦', '✧', '✩', '✪', '✫', '✬', '✭', '✮', '✯'];

  const allSpinners = [...brailleSpinners, ...claudeSpinners];
  let result = data;

  allSpinners.forEach(char => {
    // 过滤连续出现的转圈符
    result = result.replace(new RegExp(char + '+', 'g'), '');
  });

  // 过滤 loading... 模式
  result = result.replace(/loading\.{3,}/gi, 'loading...');

  // 过滤 [=---] 进度条模式
  result = result.replace(/\[=+\s*-+\]/g, '');

  // 过滤 "... seconds... (attempt X/Y)" 重试提示
  result = result.replace(/\d+\s+seconds?\s*\.\.\.\s*\(attempt\s*\d+\/\d+\)/gi, '');

  // 过滤纯数字行（加载动画中的数字）
  result = result.replace(/^[0-9\s]+$/gm, '');

  return result;
}

/**
 * 过滤 Shell 提示符（如 Starship、Powerlevel 等美化提示符）
 * @param {string} data - 原始数据
 * @returns {string} 过滤后的数据
 */
export function filterShellPrompts(data) {
  let result = data;

  // 先过滤残留的 ANSI 序列（包括跨行的）
  // [38;5;244m 格式（256色）
  result = result.replace(/\[\d+(?:;\d+)*m/g, '');
  // 处理被换行分割的 ANSI 序列 [38;5;\n244m
  result = result.replace(/\[\d+(?:;\d+)*\s*\d*m/g, '');
  // 处理不完整的 ANSI 序列残留 [38;5;
  result = result.replace(/\[\d+(?:;\d+)*;?\s*$/gm, '');
  // 处理残留的数字+m（如 244m，是被分割后的 ANSI 序列后半部分）
  result = result.replace(/^\d+m$/gm, '');
  result = result.replace(/\n\d+m\n/g, '\n');

  // 过滤 Starship/Powerlevel 风格的多行提示符
  // 上边框: ╭─ ... ─╮
  result = result.replace(/╭[─╌]*[╮╯]?/g, '');
  // 下边框: ╰─ ... ─╯
  result = result.replace(/╰[─╌]*[╮╯]?/g, '');

  // 过滤单独的边框字符
  result = result.replace(/[╭╮╰╯]/g, '');

  // 过滤包含路径和时间的提示符行（如 "7 ~/path ✔ 16:08:01 ─"）
  result = result.replace(/^\d*\s*[~\/][^\n]*[─╌·\s]*$/gm, '');

  // 过滤纯分隔符行（包含大量 ─ 或 · 的行，允许跨行）
  result = result.replace(/^[─╌·\s]+$/gm, '');

  // 过滤单独的 ─ 字符（提示符边框残留）
  result = result.replace(/^─+$/gm, '');

  // 过滤 ─= 或 =─ 组合（提示符残留）
  result = result.replace(/[─]=?/g, '');

  // 过滤简单的路径提示符行（单独一行的 ~/path 或 /path）
  result = result.replace(/^[\s]*[~\/][a-zA-Z0-9_\/\-\.]*[\s]*$/gm, '');

  // 过滤单独的 % 或 = 符号行（zsh/node 的输出结束标记）
  result = result.replace(/^[\s]*[%=][\s]*$/gm, '');

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

  // 4. 过滤 Shell 提示符
  result = filterShellPrompts(result);

  // 5. 移除多余的空白行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result;
}

export default {
  stripAnsiCodes,
  filterControlChars,
  filterLoadingAnimations,
  filterShellPrompts,
  purify
};
