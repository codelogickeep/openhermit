/**
 * SystemCommands - 系统命令处理模块
 * 负责处理 OpenHermit 系统命令（- 前缀）
 */

import logger from '../utils/logger.js';

/**
 * 系统命令处理类
 */
export class SystemCommands {
  /**
   * 处理系统命令（- 前缀）
   * @param {string} command - 命令（包含 - 前缀）
   * @param {object} context - 上下文对象
   */
  handle(command, context) {
    const parts = command.slice(1).trim().split(/\s+/); // 移除 - 前缀
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case 'cd':
        this.handleCd(args, context);
        break;
      case 'ls':
        this.handleLs(context);
        break;
      case 'claude':
        this.handleClaude(args, context);
        break;
      case 'status':
        this.handleStatus(context);
        break;
      case 'help':
        this.handleHelp(context);
        break;
      default:
        context.channel.send(`❌ 未知命令: \`-${cmd}\`\n\n使用 \`-help\` 查看可用命令。`, { immediate: true });
    }
  }

  /**
   * 处理 -help 命令
   * @param {object} context - 上下文对象
   */
  handleHelp(context) {
    const msg = `## 📖 OpenHermit 帮助

### 📂 目录管理
| 命令 | 说明 |
|------|------|
| \`-cd <目录>\` | 切换工作目录 |
| \`-ls\` | 查看可选目录 |

### 🚀 系统命令
| 命令 | 说明 |
|------|------|
| \`-claude [任务]\` | 启动 Claude Code |
| \`-status\` | 查看执行状态 |
| \`-help\` | 查看帮助 |

### 💻 Bash 命令
| 命令 | 说明 |
|------|------|
| \`!<命令>\` | 在工作目录执行 bash 命令 |

### ⌨️ 快捷指令
| 指令 | 说明 |
|------|------|
| \`esc\` | 终止 Claude Code 当前任务（发送两次 ESC） |

### 💡 使用说明
- 带 \`-\` 前缀的命令由 OpenHermit 处理
- 带 \`!\` 前缀的命令在工作目录执行 bash
- 发送 \`esc\` 可终止 Claude Code 当前任务
- 其他所有内容直接发送给 Claude 终端`;

    context.channel.send(msg, { immediate: true });
  }

  /**
   * 处理 -cd 命令
   * @param {string} path - 目标路径
   * @param {object} context - 上下文对象
   */
  handleCd(path, context) {
    const { channel, pty, getAllowedRootDir } = context;

    if (!path) {
      channel.send('用法: `-cd <目录路径>`', { immediate: true });
      return;
    }

    // 处理相对路径
    let targetPath = path;
    if (!path.startsWith('/')) {
      targetPath = `${pty.getWorkingDir()}/${path}`;
    }

    const success = pty.setWorkingDir(targetPath);

    if (success) {
      channel.send(`✅ 已切换到: \`${pty.getWorkingDir()}\``, { immediate: true });
    } else {
      const rootDir = getAllowedRootDir();
      channel.send(`❌ 切换失败: 仅允许在 \`${rootDir}\` 下操作`, { immediate: true });
    }
  }

  /**
   * 处理 -ls 命令
   * @param {object} context - 上下文对象
   */
  handleLs(context) {
    const { channel, pty } = context;
    channel.sendDirList(pty.getWorkingDir());
  }

  /**
   * 处理 -claude 命令 - 直接启动 Claude
   * @param {string} args - 可选的任务描述
   * @param {object} context - 上下文对象
   */
  handleClaude(args, context) {
    const { channel, pty, intentParser } = context;
    const session = intentParser.getSession();

    if (session.mode === 'claude_active') {
      channel.send('⚠️ Claude 已在运行中，直接发送消息即可', { immediate: true });
      return;
    }

    // 启动 Claude（直接写入命令和回车，不使用延迟）
    if (args) {
      // 带任务描述
      const escaped = args.replace(/'/g, "'\\''");
      pty.write(`claude '${escaped}'\r`);
      channel.send(`🚀 启动 Claude Code: ${args}`, { immediate: true });
    } else {
      // 纯启动
      pty.write('claude\r');
      channel.send('🚀 启动 Claude Code', { immediate: true });
    }

    session.setMode('claude_active');
  }

  /**
   * 处理 -status 命令 - 查看系统状态
   * @param {object} context - 上下文对象
   */
  async handleStatus(context) {
    const { channel, pty, intentParser, taskStatus, terminalBuffer, smartMode, llmClient } = context;
    const session = intentParser.getSession();

    let msg = '## 📊 系统状态\n\n';
    msg += `| 项目 | 状态 |\n|------|------|\n`;
    msg += `| 会话模式 | ${session.mode === 'claude_active' ? '🟢 Claude 活跃' : '⚪ 空闲'} |\n`;
    msg += `| 任务状态 | ${taskStatus.isRunning ? '🔄 运行中' : '⚪ 空闲'} |\n`;
    msg += `| 静默模式 | ${channel.silentMode ? '是' : '否'} |\n`;

    if (taskStatus.isRunning && taskStatus.startTime) {
      const elapsed = Math.floor((Date.now() - taskStatus.startTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      msg += `| 运行时间 | ${minutes}分${seconds}秒 |\n`;
    }

    msg += `\n**当前目录:** \`${pty.getWorkingDir()}\``;

    // 使用 LLM 总结最近输出（使用完整的终端缓冲区）
    if (terminalBuffer && terminalBuffer.trim().length > 50) {
      msg += '\n\n### 📝 最近输出\n';

      if (smartMode) {
        try {
          // 使用 LLM 总结
          const summary = await llmClient.summarizeStatus(terminalBuffer);
          msg += summary;
        } catch (error) {
          // 降级：显示原始输出的最后部分
          msg += this.getFallbackStatusOutput(terminalBuffer);
        }
      } else {
        // 非智能模式：显示原始输出
        msg += this.getFallbackStatusOutput(terminalBuffer);
      }
    }

    // 立即发送状态信息
    channel.sendImmediate(msg);
  }

  /**
   * 获取降级的最近输出（用于 -status 命令）
   * @param {string} terminalBuffer - 终端缓冲区
   * @returns {string} 格式化的输出
   */
  getFallbackStatusOutput(terminalBuffer) {
    if (!terminalBuffer || terminalBuffer.trim().length < 20) {
      return '暂无有效输出';
    }

    // 清理并截取最后 200 字符
    let cleaned = terminalBuffer
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (cleaned.length > 200) {
      cleaned = '...' + cleaned.slice(-200);
    }

    return `\`\`\`\n${cleaned}\n\`\`\``;
  }
}

/**
 * 创建 SystemCommands 实例
 * @returns {SystemCommands}
 */
export function getSystemCommands() {
  return new SystemCommands();
}

export default SystemCommands;
