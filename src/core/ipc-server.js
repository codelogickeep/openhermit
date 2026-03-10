/**
 * IPC Server - 轻量 HTTP 服务
 * 接收 Claude Code Hooks 发来的事件
 */

import http from 'http';
import logger from '../utils/logger.js';

/**
 * IPC Server 类
 */
class IPCServer {
  constructor(port = 31337) {
    this.port = port;
    this.server = null;
    this.eventHandlers = new Map();
    this.isRunning = false;
  }

  /**
   * 启动 IPC 服务
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      logger.warn('IPC Server 已在运行');
      return;
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
