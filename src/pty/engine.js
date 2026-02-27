import pty from 'node-pty';
import path from 'path';
import { buildEnv, getDefaultShell } from './envBuild.js';
import { getAllowedRootDir } from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * PTY 引擎类
 * 管理伪终端的启动、写入、关闭等操作
 */
class PTYEngine {
  constructor() {
    this.pty = null;
    this.workingDir = getAllowedRootDir();
    this.dataCallbacks = [];
    this.exitCallbacks = [];
    this.shell = getDefaultShell();
  }

  /**
   * 启动 PTY 进程
   */
  start() {
    if (this.pty) {
      logger.warn('PTY 已启动，无需重复启动');
      return;
    }

    const env = buildEnv({ cwd: this.workingDir });

    logger.info({ shell: this.shell, cwd: this.workingDir }, '启动 PTY');

    this.pty = pty.spawn(this.shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: this.workingDir,
      env: env
    });

    this.pty.onData((data) => {
      this.dataCallbacks.forEach(cb => cb(data));
    });

    this.pty.onExit(({ exitCode, signal }) => {
      logger.info({ exitCode, signal }, 'PTY 进程退出');
      this.pty = null;
      this.exitCallbacks.forEach(cb => cb({ exitCode, signal }));
    });

    return this;
  }

  /**
   * 写入数据到 PTY
   * @param {string} data - 要写入的数据
   */
  write(data) {
    if (!this.pty) {
      logger.warn('PTY 未启动，无法写入');
      return;
    }
    this.pty.write(data);
  }

  /**
   * 注册数据监听器
   * @param {function} callback - 回调函数
   */
  onData(callback) {
    this.dataCallbacks.push(callback);
  }

  /**
   * 注册退出监听器
   * @param {function} callback - 回调函数
   */
  onExit(callback) {
    this.exitCallbacks.push(callback);
  }

  /**
   * 获取当前工作目录
   * @returns {string}
   */
  getWorkingDir() {
    return this.workingDir;
  }

  /**
   * 设置工作目录
   * @param {string} dir - 新目录
   * @returns {boolean} 是否成功
   */
  setWorkingDir(dir) {
    // 验证目录是否在白名单内
    const rootDir = getAllowedRootDir();
    const resolvedPath = path.resolve(this.workingDir, dir);

    if (!resolvedPath.startsWith(rootDir)) {
      logger.warn({ dir, rootDir }, '拒绝切换到白名单外的目录');
      return false;
    }

    // 检查目录是否存在
    const fs = require('fs');
    if (!fs.existsSync(resolvedPath)) {
      logger.warn({ dir }, '目录不存在');
      return false;
    }

    this.workingDir = resolvedPath;
    logger.info({ dir: resolvedPath }, '工作目录已切换');

    // 发送 cd 命令到 PTY
    this.write(`cd "${resolvedPath}"\r`);

    return true;
  }

  /**
   * 重启 PTY 进程
   */
  restart() {
    logger.info('重启 PTY');
    this.kill();
    this.start();
  }

  /**
   * 终止 PTY 进程
   */
  kill() {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
      logger.info('PTY 已终止');
    }
  }

  /**
   * 检查 PTY 是否在运行
   * @returns {boolean}
   */
  isRunning() {
    return this.pty !== null;
  }
}

export default PTYEngine;
