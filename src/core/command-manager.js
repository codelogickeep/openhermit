/**
 * Command Manager
 * 管理钉钉 → Claude Code 的命令传递
 *
 * 工作流程:
 * 1. 用户在钉钉发送消息
 * 2. OpenHermit 收到消息，调用 writeCommand() 写入命令文件
 * 3. Claude Code 的 notification.sh Hook 轮询命令文件
 * 4. 检测到命令文件后，读取并输出到 stdout
 * 5. Claude Code 执行命令
 */

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

// 默认配置
const DEFAULT_TIMEOUT = 600; // 10 分钟
const DEFAULT_MAX_AGE = 1200000; // 20 分钟

class CommandManager {
  constructor() {
    // 待处理的命令 (commandId -> commandInfo)
    this.pendingCommands = new Map();

    // 活跃的 Claude 会话 (sessionId -> sessionInfo)
    this.activeSession = null;

    // 超时回调
    this.onTimeout = null;
    this.onCommandProcessed = null;
  }

  /**
   * 设置活跃会话
   * @param {object} session - 会话信息
   */
  setActiveSession(session) {
    this.activeSession = session;
    logger.debug({ session }, '📍 活跃会话已更新');
  }

  /**
   * 获取活跃会话
   * @returns {object|null}
   */
  getActiveSession() {
    return this.activeSession;
  }

  /**
   * 清除活跃会话
   */
  clearActiveSession() {
    this.activeSession = null;
    logger.debug('📍 活跃会话已清除');
  }

  /**
   * 写入命令文件
   * @param {string} projectDir - 项目目录
   * @param {string} command - 命令内容
   * @param {object} meta - 元数据
   * @returns {object} 命令信息
   */
  writeCommand(projectDir, command, meta = {}) {
    // 命令文件写入项目目录下的 .claude/.openhermit/commands/
    // stop.sh 会轮询这个目录
    const commandDir = path.join(projectDir, '.claude', '.openhermit', 'commands');
    const timestamp = Date.now();
    const commandId = `${timestamp}`;
    const commandFile = path.join(commandDir, `${commandId}.txt`);

    // 去除首尾空白
    const trimmedCommand = command.trim();

    try {
      // 确保目录存在
      fs.mkdirSync(commandDir, { recursive: true });

      // 写入命令文件
      fs.writeFileSync(commandFile, trimmedCommand);

      const commandInfo = {
        commandId,
        commandFile,
        command: trimmedCommand,
        projectDir,
        projectName: path.basename(projectDir),
        createdAt: new Date().toISOString(),
        ...meta
      };

      // 记录待处理命令
      this.pendingCommands.set(commandId, commandInfo);

      logger.info({ commandId, commandFile, command: trimmedCommand }, '📝 命令文件已写入');

      return commandInfo;
    } catch (error) {
      logger.error({ error: error.message, commandDir }, '❌ 写入命令文件失败');
      throw error;
    }
  }

  /**
   * 删除命令文件
   * @param {string} commandFile - 命令文件路径
   */
  removeCommand(commandFile) {
    try {
      if (fs.existsSync(commandFile)) {
        fs.unlinkSync(commandFile);
        logger.info({ commandFile }, '🗑️ 命令文件已删除');
      }

      // 从待处理列表中移除
      for (const [id, info] of this.pendingCommands.entries()) {
        if (info.commandFile === commandFile) {
          this.pendingCommands.delete(id);
          break;
        }
      }
    } catch (error) {
      logger.error({ error: error.message, commandFile }, '❌ 删除命令文件失败');
    }
  }

  /**
   * 清理过期命令
   * @param {string} projectDir - 项目目录
   * @param {number} maxAge - 最大年龄（毫秒）
   */
  cleanupExpiredCommands(projectDir, maxAge = DEFAULT_MAX_AGE) {
    const commandDir = path.join(projectDir, '.claude', '.openhermit', 'commands');

    if (!fs.existsSync(commandDir)) return;

    const now = Date.now();
    const files = fs.readdirSync(commandDir).filter(f => f.endsWith('.txt'));
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(commandDir, file);
      const timestamp = parseInt(file.replace('.txt', ''), 10);

      if (now - timestamp > maxAge) {
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch (error) {
          logger.warn({ error: error.message, file }, '清理过期命令失败');
        }
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, projectDir }, '🗑️ 已清理过期命令文件');
    }
  }

  /**
   * 处理命令已执行通知
   * @param {object} data - 通知数据
   */
  handleCommandProcessed(data) {
    const { file, session } = data;
    logger.info({ file, session }, '✅ 命令已被 Claude Code 执行');

    // 从待处理列表中移除
    for (const [id, info] of this.pendingCommands.entries()) {
      if (info.commandFile === file) {
        this.pendingCommands.delete(id);

        // 调用回调
        if (this.onCommandProcessed) {
          this.onCommandProcessed(info);
        }
        break;
      }
    }
  }

  /**
   * 处理超时通知
   * @param {object} data - 通知数据
   * @returns {object} 超时信息
   */
  handleCommandTimeout(data) {
    const { session, timeout } = data;
    logger.warn({ session, timeout }, '⏰ 命令等待超时');

    const sessionInfo = this.activeSession;
    const projectName = sessionInfo?.projectName || path.basename(sessionInfo?.cwd || 'unknown');

    const result = {
      timedOut: true,
      session,
      timeout,
      projectName
    };

    // 调用回调
    if (this.onTimeout) {
      this.onTimeout(result);
    }

    return result;
  }

  /**
   * 检查是否可以接收命令
   * 会话状态为 idle 或 completed 时都可以接收命令
   * @returns {boolean}
   */
  canAcceptCommand() {
    return this.activeSession &&
      (this.activeSession.state === 'idle' || this.activeSession.state === 'completed');
  }

  /**
   * 获取活跃会话
   * @returns {object|null}
   */
  getActiveSession() {
    return this.activeSession;
  }

  /**
   * 获取待处理命令数量
   * @returns {number}
   */
  getPendingCount() {
    return this.pendingCommands.size;
  }
}

// 单例
let instance = null;

/**
 * 获取 CommandManager 实例
 * @returns {CommandManager}
 */
export function getCommandManager() {
  if (!instance) {
    instance = new CommandManager();
  }
  return instance;
}

/**
 * 重置 CommandManager（用于测试）
 */
export function resetCommandManager() {
  instance = null;
}

export { CommandManager };
