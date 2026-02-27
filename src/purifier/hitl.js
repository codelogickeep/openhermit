/**
 * HITL (Human-in-the-Loop) 检测器
 * 用于检测需要用户审批的交互提示
 */

// HITL 模式列表
const HITL_PATTERNS = [
  // 是/否 提示
  /\(y\/n\)/i,
  /\(Y\/N\)/i,
  /\(yes\/no\)/i,
  /\(YES\/NO\)/i,
  /\[y\/n\]/i,
  /\[Y\/N\]/i,
  /do you want to.*\?/i,
  /are you sure.*\?/i,
  /continue\?/i,
  /proceed\?/i,

  // Allow/批准 提示
  /allow.*\?/i,
  /permission.*\?/i,
  /authorize.*\?/i,
  /approve.*\?/i,

  // 命令执行确认
  /run this command\?/i,
  /execute.*\?/i,
  /install.*\?/i,
  /delete.*\?/i,
  /remove.*\?/i,

  // Git 确认
  /commit.*\?/i,
  /push.*\?/i,
  /force push.*\?/i,
  /merge.*\?/i,

  // npm/yarn 确认
  /install packages\?/i,
  /update packages\?/i,
  /remove packages\?/i,

  // Docker 确认
  /remove container\?/i,
  /remove image\?/i,
  /stop container\?/i
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
