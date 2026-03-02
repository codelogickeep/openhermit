/**
 * TerminalLogger - 终端输出日志管理模块
 * 负责将 PTY 输出记录到日志文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 终端输出日志管理类
 */
export class TerminalLogger {
  constructor() {
    this.logFile = null;
    this.logStream = null;
    this.logBuffer = '';
    this.flushTimer = null;
    this.maxLogFileSize = 5 * 1024 * 1024; // 5MB
  }

  /**
   * 生成带时间戳的日志文件名
   * @returns {string} 日志文件路径
   */
  generateLogFileName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    const timestamp = `${year}${month}${day}-${hour}${minute}${second}`;
    return path.join(process.cwd(), `claude-terminal-${timestamp}.log`);
  }

  /**
   * 初始化终端输出日志文件
   */
  init() {
    try {
      this.logFile = this.generateLogFileName();
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      this.logBuffer = '';

      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      this.logStream.write(`\n${'═'.repeat(70)}\n`);
      this.logStream.write(`  OpenHermit 启动 - ${timestamp}\n`);
      this.logStream.write(`  日志文件: ${this.logFile}\n`);
      this.logStream.write(`${'═'.repeat(70)}\n\n`);

      logger.info({ file: this.logFile }, '📝 终端输出日志文件已创建');
    } catch (error) {
      logger.error({ error: error.message }, '创建终端日志文件失败');
    }
  }

  /**
   * 写入终端输出到日志文件（使用缓冲区）
   * @param {string} data - 终端输出数据
   */
  write(data) {
    if (!this.logStream || !data || !data.trim()) return;

    // 追加到缓冲区
    this.logBuffer += data;

    // 清除之前的定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    // 500ms 后刷新缓冲区，或者缓冲区超过 1000 字符时立即刷新
    if (this.logBuffer.length >= 1000) {
      this.flush();
    } else {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, 500);
    }
  }

  /**
   * 刷新终端日志缓冲区
   */
  flush() {
    if (!this.logStream || !this.logBuffer.trim()) return;

    try {
      // 检查文件大小，超过限制则轮转
      const stats = fs.statSync(this.logFile);
      if (stats.size >= this.maxLogFileSize) {
        this.rotate();
      }

      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      const content = this.logBuffer;

      this.logStream.write(`\n${'─'.repeat(70)}\n`);
      this.logStream.write(`  [${timestamp}]\n`);
      this.logStream.write(`${'─'.repeat(70)}\n`);
      this.logStream.write(content);
      this.logStream.write('\n');

      // 清空缓冲区
      this.logBuffer = '';
    } catch (error) {
      // 忽略写入错误
    }
  }

  /**
   * 写入缓冲区信息到日志（用于调试）
   * @param {string} bufferData - 缓冲区数据
   */
  writeBuffer(bufferData) {
    if (!this.logStream || !bufferData) return;

    try {
      this.logStream.write(`\n${'▼'.repeat(35)}\n`);
      this.logStream.write(`  [缓冲区数据 - 用于 LLM 分析]\n`);
      this.logStream.write(`${'▼'.repeat(35)}\n`);
      this.logStream.write(bufferData);
      this.logStream.write('\n');
    } catch (error) {
      // 忽略写入错误
    }
  }

  /**
   * 轮转日志文件
   */
  rotate() {
    // 先刷新缓冲区
    this.flush();
    this.close();
    this.init();
    logger.info('📝 终端日志文件已轮转');
  }

  /**
   * 关闭终端日志文件
   */
  close() {
    // 清除定时器
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 刷新剩余缓冲区
    if (this.logBuffer) {
      this.flush();
    }

    if (this.logStream) {
      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      this.logStream.write(`\n${'═'.repeat(70)}\n`);
      this.logStream.write(`  OpenHermit 停止 - ${timestamp}\n`);
      this.logStream.write(`${'═'.repeat(70)}\n`);
      this.logStream.end();
      this.logStream = null;
    }
  }
}

/**
 * 创建 TerminalLogger 实例
 * @returns {TerminalLogger}
 */
export function getTerminalLogger() {
  return new TerminalLogger();
}

export default TerminalLogger;
