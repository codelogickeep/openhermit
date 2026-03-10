import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock logger
vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

import { IPCServer, getIPCServer, resetIPCServer } from '../src/core/ipc-server.js';

describe('IPCServer', () => {
  let server;
  const testPort = 31338; // 使用不同端口避免冲突

  beforeEach(() => {
    resetIPCServer();
    server = new IPCServer(testPort);
  });

  afterEach(async () => {
    if (server && server.isRunning) {
      server.stop();
    }
  });

  describe('构造函数', () => {
    it('应该使用默认端口', () => {
      const defaultServer = new IPCServer();
      expect(defaultServer.port).toBe(31337);
    });

    it('应该使用指定端口', () => {
      expect(server.port).toBe(testPort);
    });

    it('初始状态应该未运行', () => {
      expect(server.isRunning).toBe(false);
    });

    it('初始应该没有注册事件处理器', () => {
      expect(server.eventHandlers.size).toBe(0);
    });
  });

  describe('start()', () => {
    it('应该成功启动服务', async () => {
      await server.start();
      expect(server.isRunning).toBe(true);
    });

    it('重复启动应该警告但不报错', async () => {
      await server.start();
      await server.start(); // 不应该抛错
      expect(server.isRunning).toBe(true);
    });
  });

  describe('stop()', () => {
    it('应该停止服务', async () => {
      await server.start();
      server.stop();
      expect(server.isRunning).toBe(false);
    });

    it('停止未启动的服务不应该报错', () => {
      server.stop(); // 不应该抛错
      expect(server.isRunning).toBe(false);
    });
  });

  describe('事件处理器', () => {
    it('应该注册事件处理器', () => {
      const handler = vi.fn();
      server.on('pre-tool', handler);
      expect(server.eventHandlers.has('pre-tool')).toBe(true);
    });

    it('应该移除事件处理器', () => {
      const handler = vi.fn();
      server.on('pre-tool', handler);
      server.off('pre-tool');
      expect(server.eventHandlers.has('pre-tool')).toBe(false);
    });
  });

  describe('getStatus()', () => {
    it('应该返回正确的状态', async () => {
      server.on('pre-tool', vi.fn());
      server.on('notification', vi.fn());

      const status = server.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.port).toBe(testPort);
      expect(status.registeredHooks).toContain('pre-tool');
      expect(status.registeredHooks).toContain('notification');
    });

    it('启动后应该返回运行状态', async () => {
      await server.start();
      const status = server.getStatus();
      expect(status.isRunning).toBe(true);
    });
  });

  describe('handleRequest()', () => {
    it('应该拒绝非 POST 请求', async () => {
      await server.start();

      const req = { method: 'GET', url: '/hook/pre-tool' };
      const res = {
        writeHead: vi.fn(),
        end: vi.fn()
      };

      server.handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(405, { 'Content-Type': 'text/plain' });
      expect(res.end).toHaveBeenCalledWith('Method Not Allowed');
    });

    it('应该返回 404 对于非 hook 路径', async () => {
      await server.start();

      const req = { method: 'POST', url: '/other' };
      const res = {
        writeHead: vi.fn(),
        end: vi.fn()
      };

      server.handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
      expect(res.end).toHaveBeenCalledWith('Not Found');
    });
  });

  describe('单例模式', () => {
    it('getIPCServer 应该返回单例', () => {
      const instance1 = getIPCServer();
      const instance2 = getIPCServer();
      expect(instance1).toBe(instance2);
    });

    it('resetIPCServer 应该重置单例', () => {
      const instance1 = getIPCServer();
      resetIPCServer();
      const instance2 = getIPCServer();
      expect(instance1).not.toBe(instance2);
    });
  });
});
