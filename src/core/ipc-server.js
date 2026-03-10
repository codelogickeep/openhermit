/**
 * IPC Server - 轻量 HTTP 服务
 * 接收 Claude Code Hooks 发来的事件
 */

import http from 'http';
import { exec } from 'child_process';
import logger from '../utils/logger.js';

/**
 * 检查端口是否被占用
 * @param {number} port - 端口号
 * @returns {Promise<number|null>} 占用端口的进程 PID，null 表示端口空闲
 */
async function findProcessUsingPort(port) {
  return new Promise((resolve) => {
    // macOS/Linux 使用 lsof
    exec(`lsof -i :${port} -t`, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }
      const pid = parseInt(stdout.trim().split('\n')[0]);
      resolve(isNaN(pid) ? null : pid);
    });
  });
}

/**
 * 终止占用端口的进程
 * @param {number} pid - 进程 PID
 * @returns {Promise<boolean>} 是否成功终止
 */
async function killProcess(pid) {
  return new Promise((resolve) => {
    exec(`kill -9 ${pid}`, (error) => {
      if (error) {
        logger.warn({ pid, error: error.message }, '终止进程失败');
        resolve(false);
      } else {
        logger.info({ pid }, '✅ 已终止残留进程');
        resolve(true);
      }
    });
  });
}

/**
 * 清理占用端口的残留进程
 * @param {number} port - 端口号
 * @returns {Promise<boolean>} 是否成功清理
 */
async function cleanupPort(port) {
  const pid = await findProcessUsingPort(port);
  if (pid) {
    logger.warn({ port, pid }, '⚠️ 发现端口被残留进程占用，尝试清理...');
    const killed = await killProcess(pid);
    if (killed) {
      // 等待端口释放
      await new Promise(r => setTimeout(r, 500));
      return true;
    }
    return false;
  }
  return true; // 端口未被占用
}

/**
 * IPC Server 类
 */
class IPCServer {
  constructor(port = 31337) {
    this.port = port;
    this.server = null;
    this.eventHandlers = new Map();
    this.isRunning = false;
    this.cleanupRegistered = false;
  }

  /**
   * 注册进程退出清理
   */
  registerCleanup() {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => {
      if (this.server) {
        this.server.close();
        logger.info('🧹 IPC Server 已在进程退出时清理');
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
  }

  /**
   * 启动 IPC 服务
   * @param {boolean} autoCleanup - 是否自动清理残留进程（默认 true）
   * @returns {Promise<void>}
   */
  async start(autoCleanup = true) {
    if (this.isRunning) {
      logger.warn('IPC Server 已在运行');
      return;
    }

    // 注册退出清理
    this.registerCleanup();

    // 自动清理残留进程
    if (autoCleanup) {
      const cleaned = await cleanupPort(this.port);
      if (!cleaned) {
        throw new Error(`端口 ${this.port} 被占用且无法清理`);
      }
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger.error({ port: this.port }, 'IPC 端口已被占用');
          reject(new Error(`端口 ${this.port} 已被占用`));
        } else {
          logger.error({ error: error.message }, 'IPC Server 错误');
          reject(error);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        this.isRunning = true;
        logger.info({ port: this.port }, '🔒 IPC Server 已启动');
        resolve();
      });
    });
  }

  /**
   * 巻加事件处理器
   * @param {string} eventType - 事件类型 (pre-tool, notification, stop)
   * @param {Function} handler - 处理函数
   */
  on(eventType, handler) {
    this.eventHandlers.set(eventType, handler);
  }

  /**
   * 移除事件处理器
   * @param {string} eventType - 事件类型
   */
  off(eventType) {
    this.eventHandlers.delete(eventType);
  }

  /**
   * 处理 HTTP 请求
   * @param {object} req - HTTP 请求对象
   * @param {object} res - HTTP 响应对象
   */
  handleRequest(req, res) {
    // 只处理 POST 请求
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    // 解析路由
    const url = req.url;
    const hookMatch = url.match(/^\/hook\/(.+)$/);

    if (!hookMatch) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const hookType = hookMatch[1];

    // 读取请求体
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        // 解析 JSON
        let data = {};
        if (body && body.trim()) {
          data = JSON.parse(body);
        }

        // 记录接收到的 Hook 事件（完整数据）
        logger.info({
          hookType,
          toolName: data.tool_name,
          sessionId: data.session_id,
          dataSize: body.length,
          rawData: data
        }, '📥 收到 Hook 事件');

        // 调用对应的事件处理器
        const handler = this.eventHandlers.get(hookType);
        if (handler) {
          try {
            // 支持 async 处理器
            const result = handler(data);
            if (result && typeof result.catch === 'function') {
              result.catch(error => {
                logger.error({ hookType, error: error.message }, 'Hook 处理器执行失败');
              });
            }
          } catch (error) {
            logger.error({ hookType, error: error.message }, 'Hook 处理器执行失败');
          }
        } else {
          logger.debug({ hookType }, '没有注册的 Hook 类型');
        }

        // 立即返回 200 OK（避免阻塞 Claude Code）
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');

      } catch (error) {
        logger.error({ hookType, error: error.message }, 'Hook 事件解析失败');
        // 仍然返回 200，避免影响 Claude Code
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      }
    });
  }

  /**
   * 停止 IPC 服务
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.isRunning = false;
      logger.info('IPC Server 已停止');
    }
  }

  /**
   * 获取服务状态
   * @returns {object}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      registeredHooks: Array.from(this.eventHandlers.keys())
    };
  }
}

// 单例
let instance = null;

/**
 * 获取 IPC Server 实例
 * @param {number} port - 端口号
 * @returns {IPCServer}
 */
export function getIPCServer(port = 31337) {
  if (!instance) {
    instance = new IPCServer(port);
  }
  return instance;
}

/**
 * 重置 IPC Server（用于测试）
 */
export function resetIPCServer() {
  if (instance) {
    instance.stop();
    instance = null;
  }
}

export { IPCServer };
