/**
 * Security - 命令安全检测模块
 * 负责检测和评估命令执行风险
 */

import logger from '../utils/logger.js';
import { getAllowedRootDir } from '../config/index.js';

/**
 * 风险等级
 */
export const RiskLevel = {
  LOW: 'low',           // 允许执行，记录日志
  MEDIUM: 'medium',     // 允许执行，警告用户
  HIGH: 'high',         // 需要用户确认（HITL）
  CRITICAL: 'critical'  // 拒绝执行
};

/**
 * 危险命令模式
 */
const DANGEROUS_PATTERNS = [
  // 系统破坏
  { pattern: /rm\s+-rf\s+\//i, level: RiskLevel.CRITICAL, reason: '禁止删除根目录' },
  { pattern: /rm\s+-rf\s+~/i, level: RiskLevel.CRITICAL, reason: '禁止删除用户目录' },
  { pattern: /rm\s+-rf\s+\*/i, level: RiskLevel.CRITICAL, reason: '禁止批量删除' },
  { pattern: /rm\s+-rf\s+\./i, level: RiskLevel.HIGH, reason: '删除当前目录' },
  { pattern: /mkfs/i, level: RiskLevel.CRITICAL, reason: '禁止格式化磁盘' },
  { pattern: /dd\s+if=.*of=\/dev\//i, level: RiskLevel.CRITICAL, reason: '禁止写入设备文件' },
  { pattern: /:?\(\)\s*\{\s*:\s*\|\s*:&\s*\}\s*;:/, level: RiskLevel.CRITICAL, reason: '禁止 Fork Bomb' },

  // 命令注入特征
  { pattern: /\beval\b/i, level: RiskLevel.HIGH, reason: '禁止使用 eval（命令注入风险）' },
  { pattern: /\bexec\b/i, level: RiskLevel.HIGH, reason: '禁止使用 exec（命令注入风险）' },
  { pattern: /\bsource\b/i, level: RiskLevel.MEDIUM, reason: 'source 命令需谨慎' },
  { pattern: /\.\s+/, level: RiskLevel.MEDIUM, reason: '点号执行脚本需谨慎' },

  // 命令替换（可能隐藏恶意代码）
  { pattern: /\$\([^)]*\)/, level: RiskLevel.MEDIUM, reason: '命令替换 $(...) 可能隐藏恶意代码' },
  { pattern: /`[^`]*`/, level: RiskLevel.MEDIUM, reason: '反引号命令替换可能隐藏恶意代码' },

  // 编码绕过检测
  { pattern: /base64\s+-d/i, level: RiskLevel.HIGH, reason: 'Base64 解码可能绕过检测' },
  { pattern: /xxd\s+-r/i, level: RiskLevel.HIGH, reason: '十六进制解码可能绕过检测' },
  { pattern: /printf\s+\\x/i, level: RiskLevel.HIGH, reason: '十六进制编码可能绕过检测' },
  { pattern: /\\x[0-9a-f]{2}/i, level: RiskLevel.MEDIUM, reason: '检测到十六进制编码字符' },

  // 权限提升
  { pattern: /\bsudo\b/i, level: RiskLevel.HIGH, reason: '需要 sudo 权限' },
  { pattern: /\bsu\b\s+/i, level: RiskLevel.HIGH, reason: '需要切换用户' },
  { pattern: /chmod\s+777/i, level: RiskLevel.HIGH, reason: '禁止设置完全开放权限' },
  { pattern: /chmod\s+-R\s+777/i, level: RiskLevel.CRITICAL, reason: '禁止递归设置完全开放权限' },
  { pattern: /chown\s+.*root/i, level: RiskLevel.HIGH, reason: '修改文件所有者为 root' },

  // 敏感路径
  { pattern: /\/etc\/passwd/i, level: RiskLevel.CRITICAL, reason: '禁止访问系统密码文件' },
  { pattern: /\/etc\/shadow/i, level: RiskLevel.CRITICAL, reason: '禁止访问系统影子文件' },
  { pattern: /\/\.ssh\//i, level: RiskLevel.HIGH, reason: '禁止访问 SSH 配置' },
  { pattern: /\/root\//i, level: RiskLevel.HIGH, reason: '禁止访问 root 目录' },
  { pattern: /\/\.bash_history/i, level: RiskLevel.HIGH, reason: '禁止访问命令历史' },
  { pattern: /\/\.gnupg\//i, level: RiskLevel.HIGH, reason: '禁止访问 GPG 配置' },

  // 远程执行
  { pattern: /curl\s+.*\|\s*(bash|sh|zsh)/i, level: RiskLevel.CRITICAL, reason: '禁止从网络直接执行脚本' },
  { pattern: /wget\s+.*\|\s*(bash|sh|zsh)/i, level: RiskLevel.CRITICAL, reason: '禁止从网络直接执行脚本' },
  { pattern: /curl\s+.*>\s*\/tmp\/.*&&\s*(bash|sh|zsh)/i, level: RiskLevel.HIGH, reason: '可疑的远程脚本执行' },
  { pattern: /\bnc\b.*\s+-e\s+/i, level: RiskLevel.CRITICAL, reason: '禁止反向 Shell' },
  { pattern: /\bncat\b.*\s+-e\s+/i, level: RiskLevel.CRITICAL, reason: '禁止反向 Shell' },
  { pattern: /\/dev\/tcp\//i, level: RiskLevel.CRITICAL, reason: '禁止 bash 网络连接' },
  { pattern: /\/dev\/udp\//i, level: RiskLevel.CRITICAL, reason: '禁止 bash 网络连接' },
  { pattern: /bash\s+.*\|\s*base64\s+-d/i, level: RiskLevel.CRITICAL, reason: 'Base64 解码后执行（危险）' },
  { pattern: /base64\s+-d.*\|\s*(bash|sh|zsh)/i, level: RiskLevel.CRITICAL, reason: 'Base64 解码后执行（危险）' },

  // 环境变量注入
  { pattern: /LD_PRELOAD=/i, level: RiskLevel.CRITICAL, reason: '禁止设置 LD_PRELOAD' },
  { pattern: /LD_LIBRARY_PATH=/i, level: RiskLevel.HIGH, reason: '可疑的库路径设置' },
  { pattern: /PATH=.*:/i, level: RiskLevel.MEDIUM, reason: '修改 PATH 可能导致命令劫持' },
  { pattern: /IFS=/i, level: RiskLevel.HIGH, reason: '修改 IFS 可能导致异常行为' },

  // 敏感信息
  { pattern: />\s*\/dev\/(sda|hda|nvme)/i, level: RiskLevel.CRITICAL, reason: '禁止写入块设备' },
  { pattern: /cat\s+\/proc\//i, level: RiskLevel.MEDIUM, reason: '访问系统进程信息' },

  // 网络相关
  { pattern: /iptables/i, level: RiskLevel.HIGH, reason: '修改防火墙规则' },
  { pattern: /netstat\s+-antp/i, level: RiskLevel.LOW, reason: '查看网络连接' },

  // 危险信号组合
  { pattern: /kill\s+-9\s+1/i, level: RiskLevel.CRITICAL, reason: '禁止杀死 init 进程' },
  { pattern: /killall\s+/i, level: RiskLevel.HIGH, reason: '批量杀死进程' },
  { pattern: /pkill\s+/i, level: RiskLevel.HIGH, reason: '按模式杀死进程' },

  // 特殊字符注入
  { pattern: /\x00/, level: RiskLevel.HIGH, reason: '检测到空字节注入' },
  { pattern: /\r/, level: RiskLevel.MEDIUM, reason: '检测到回车符（可能注入）' },
];

/**
 * 敏感目录列表
 */
const SENSITIVE_DIRS = [
  '/etc',
  '/root',
  '/var/log',
  '/boot',
  '/sys',
  '/proc',
];

/**
 * 安全检测器类
 */
class SecurityAnalyzer {
  constructor() {
    this.allowedRootDir = getAllowedRootDir();
  }

  /**
   * 分析命令风险
   * @param {string} command - 待检测的命令
   * @returns {object} 风险分析结果
   */
  analyzeCommandRisk(command) {
    if (!command || typeof command !== 'string') {
      return { level: RiskLevel.LOW, risks: [], allowed: true };
    }

    const trimmed = command.trim();
    const risks = [];

    // 1. 检查危险命令模式
    for (const { pattern, level, reason } of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        risks.push({ level, reason, pattern: pattern.source });
      }
    }

    // 2. 检查路径是否在白名单内
    const pathRisk = this.checkPathRisk(trimmed);
    if (pathRisk) {
      risks.push(pathRisk);
    }

    // 3. 检查管道和重定向风险
    const pipeRisk = this.checkPipeRisk(trimmed);
    if (pipeRisk) {
      risks.push(pipeRisk);
    }

    // 确定最终风险等级
    const level = this.getHighestRiskLevel(risks);

    return {
      level,
      risks,
      allowed: level !== RiskLevel.CRITICAL,
      requiresConfirmation: level === RiskLevel.HIGH
    };
  }

  /**
   * 检查路径风险
   * @param {string} command - 命令字符串
   * @returns {object|null} 风险对象或 null
   */
  checkPathRisk(command) {
    // 提取命令中的路径
    const pathPatterns = [
      /(?:^|\s)(\/[^\s]*)/g,  // 绝对路径
      /(?:^|\s)(~\/[^\s]*)/g, // 用户目录相对路径
    ];

    for (const pattern of pathPatterns) {
      let match;
      while ((match = pattern.exec(command)) !== null) {
        const path = match[1];

        // 检查敏感目录
        for (const sensitiveDir of SENSITIVE_DIRS) {
          if (path.startsWith(sensitiveDir)) {
            return {
              level: RiskLevel.HIGH,
              reason: `访问敏感目录: ${sensitiveDir}`,
              path
            };
          }
        }

        // 检查是否在白名单外
        if (!this.isPathAllowed(path)) {
          return {
            level: RiskLevel.MEDIUM,
            reason: `路径不在白名单内: ${path}`,
            path
          };
        }
      }
    }

    return null;
  }

  /**
   * 检查管道和重定向风险
   * @param {string} command - 命令字符串
   * @returns {object|null} 风险对象或 null
   */
  checkPipeRisk(command) {
    // 检查复杂的管道链
    const pipeCount = (command.match(/\|/g) || []).length;
    if (pipeCount > 3) {
      return {
        level: RiskLevel.MEDIUM,
        reason: `复杂的管道链 (${pipeCount} 个管道)`
      };
    }

    // 检查可疑的重定向
    if (/>>?\s*\/dev\//.test(command) && !/\/dev\/null/.test(command)) {
      return {
        level: RiskLevel.HIGH,
        reason: '写入设备文件'
      };
    }

    return null;
  }

  /**
   * 检查路径是否在白名单内
   * @param {string} path - 路径
   * @returns {boolean}
   */
  isPathAllowed(path) {
    if (!this.allowedRootDir) {
      return true; // 未配置白名单，允许所有
    }

    // 解析路径
    const normalizedPath = this.normalizePath(path);
    const normalizedRoot = this.allowedRootDir.replace(/\/+$/, '');

    return normalizedPath.startsWith(normalizedRoot);
  }

  /**
   * 规范化路径
   * @param {string} path - 原始路径
   * @returns {string} 规范化后的路径
   */
  normalizePath(path) {
    // 替换 ~ 为用户目录
    if (path.startsWith('~')) {
      path = process.env.HOME + path.slice(1);
    }

    // 解析相对路径
    if (!path.startsWith('/')) {
      path = this.allowedRootDir + '/' + path;
    }

    // 解析 ./ 和 ../
    const parts = path.split('/');
    const result = [];
    for (const part of parts) {
      if (part === '..') {
        result.pop();
      } else if (part !== '.' && part !== '') {
        result.push(part);
      }
    }

    return '/' + result.join('/');
  }

  /**
   * 获取最高风险等级
   * @param {Array} risks - 风险列表
   * @returns {string} 风险等级
   */
  getHighestRiskLevel(risks) {
    if (risks.length === 0) {
      return RiskLevel.LOW;
    }

    const levelOrder = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];
    let maxIndex = 0;

    for (const risk of risks) {
      const index = levelOrder.indexOf(risk.level);
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    return levelOrder[maxIndex];
  }

  /**
   * 生成风险报告
   * @param {object} analysis - 分析结果
   * @returns {string} 风险报告文本
   */
  generateRiskReport(analysis) {
    if (analysis.level === RiskLevel.LOW) {
      return null;
    }

    const levelEmoji = {
      [RiskLevel.LOW]: '🟢',
      [RiskLevel.MEDIUM]: '🟡',
      [RiskLevel.HIGH]: '🟠',
      [RiskLevel.CRITICAL]: '🔴'
    };

    const lines = [
      `${levelEmoji[analysis.level]} **安全风险检测**`,
      ''
    ];

    for (const risk of analysis.risks) {
      lines.push(`- ${risk.reason}`);
    }

    if (analysis.level === RiskLevel.CRITICAL) {
      lines.push('');
      lines.push('❌ **命令已被拒绝**');
    } else if (analysis.level === RiskLevel.HIGH) {
      lines.push('');
      lines.push('⚠️ **需要确认**');
    }

    return lines.join('\n');
  }
}

// 单例
let instance = null;

/**
 * 获取安全检测器实例
 * @returns {SecurityAnalyzer}
 */
export function getSecurityAnalyzer() {
  if (!instance) {
    instance = new SecurityAnalyzer();
  }
  return instance;
}

export default SecurityAnalyzer;
