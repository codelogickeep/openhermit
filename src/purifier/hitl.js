/**
 * HITL (Human-in-the-Loop) 检测器
 * 用于检测需要用户审批的危险命令交互提示
 * 注意：只检测真正的危险命令审批，选项选择由 LLM 分析处理
 */

// HITL 模式列表 - 只检测危险命令审批
const HITL_PATTERNS = [
  // Bash/Command 执行确认（带 y/n）- 任意顺序
  /bash.*\(y\/n\)/i,
  /\(y\/n\).*bash/i,
  /command.*\(y\/n\)/i,
  /\(y\/n\).*command/i,
  /execute.*\(y\/n\)/i,
  /\(y\/n\).*execute/i,
  /delete.*\(y\/n\)/i,
  /\(y\/n\).*delete/i,
  /remove.*\(y\/n\)/i,
  /\(y\/n\).*remove/i,
  /rm.*\(y\/n\)/i,
  /\(y\/n\).*rm/i,

  // Allow/批准 提示（危险操作）
  /allow.*bash.*\?/i,
  /allow.*command.*\?/i,
  /allow.*execute.*\?/i,
  /allow.*delete.*\?/i,
  /allow.*write.*\?/i,
  /allow.*edit.*\?/i,
  /allow.*remove.*\?/i,

  // 特定的危险命令确认
  /run.*command.*\?/i,
  /execute.*command.*\?/i,
  /delete.*file.*\?/i,
  /remove.*file.*\?/i,
  /force push\?/i,

  // 文件操作确认
  /overwrite.*\?/i,
  /replace.*file.*\?/i,

  // Claude Code 特有的工具确认
  /allow.*tool.*\?/i,
  /use.*tool.*\?/i
];

/**
 * 检测文本中是否包含 HITL 提示
 * @param {string} text - 待检测文本
 * @returns {boolean} 是否检测到 HITL 提示
 */
export function checkHitl(text) {
  if (!text) return false;

  for (const pattern of HITL_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * 从文本中提取 HITL 提示内容
 * @param {string} text - 待提取文本
 * @returns {string|null} 提取的提示内容，如果没有则返回 null
 */
export function extractHitlPrompt(text) {
  if (!text) return null;

  // 找到最后 200 个字符（通常是提示出现的位置）
  const recentText = text.slice(-200);

  for (const pattern of HITL_PATTERNS) {
    const match = recentText.match(pattern);
    if (match) {
      // 返回匹配位置前后的上下文
      const start = Math.max(0, match.index - 50);
      const end = Math.min(recentText.length, match.index + match[0].length + 50);
      return recentText.slice(start, end);
    }
  }

  return null;
}

/**
 * 获取 HITL 响应的默认选项
 * @returns {object} 包含 approve 和 reject 的回调函数
 */
export function getHitlOptions() {
  return {
    approve: 'y',
    reject: 'n'
  };
}

export default {
  checkHitl,
  extractHitlPrompt,
  getHitlOptions,
  HITL_PATTERNS
};
