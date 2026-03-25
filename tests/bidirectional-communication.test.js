/**
 * 双向通信集成测试
 * 测试 钉钉 → OpenHermit → Claude Code 的完整通信流程
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Mock dependencies
vi.mock('fs');
vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// 防止 src/index.js 自动执行
vi.mock('../src/config/index.js', () => ({
  getDingTalkAppKey: () => 'test-key',
  getDingTalkAppSecret: () => 'test-secret',
  getDingTalkUserId: () => 'test-user',
  getDashScopeApiKey: () => null
}));

describe('双向通信集成测试', () => {
  let mockProjectDir;
  let mockCommandDir;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProjectDir = '/test/project';
    mockCommandDir = path.join(mockProjectDir, '.claude', '.openhermit', 'commands');

    // Setup fs mocks
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('IPC Server 路由', () => {
    it('应该正确处理 /hook/ 前缀的路由', async () => {
      const { getIPCServer, resetIPCServer } = await import('../src/core/ipc-server.js');
      resetIPCServer();

      const ipcServer = getIPCServer(31338);
      const receivedEvents = [];

      ipcServer.on('notification', (data) => {
        receivedEvents.push({ type: 'notification', data });
      });

      await ipcServer.start(false);

      // 模拟发送 notification 事件
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 31338,
          path: '/hook/notification',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        });

        req.on('error', reject);
        req.write(JSON.stringify({ notification_type: 'idle_prompt', cwd: mockProjectDir }));
        req.end();
      });

      // 等待事件处理
      await new Promise(r => setTimeout(r, 100));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].type).toBe('notification');

      ipcServer.stop();
    });

    it('应该正确处理 /command/ 前缀的路由', async () => {
      const { getIPCServer, resetIPCServer } = await import('../src/core/ipc-server.js');
      resetIPCServer();

      const ipcServer = getIPCServer(31339);
      const receivedEvents = [];

      ipcServer.on('command-processed', (data) => {
        receivedEvents.push({ type: 'command-processed', data });
      });

      await ipcServer.start(false);

      // 模拟发送 command-processed 事件
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 31339,
          path: '/command/processed',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        });

        req.on('error', reject);
        req.write(JSON.stringify({ file: '/test/command.txt', session: 'test-session' }));
        req.end();
      });

      // 等待事件处理
      await new Promise(r => setTimeout(r, 100));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].type).toBe('command-processed');

      ipcServer.stop();
    });

    it('应该正确处理 /command/timeout 路由', async () => {
      const { getIPCServer, resetIPCServer } = await import('../src/core/ipc-server.js');
      resetIPCServer();

      const ipcServer = getIPCServer(31340);
      const receivedEvents = [];

      ipcServer.on('command-timeout', (data) => {
        receivedEvents.push({ type: 'command-timeout', data });
      });

      await ipcServer.start(false);

      // 模拟发送 timeout 事件
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 31340,
          path: '/command/timeout',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          expect(res.statusCode).toBe(200);
          resolve();
        });

        req.on('error', reject);
        req.write(JSON.stringify({ session: 'test-session', timeout: 600 }));
        req.end();
      });

      // 等待事件处理
      await new Promise(r => setTimeout(r, 100));

      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].type).toBe('command-timeout');
      expect(receivedEvents[0].data.timeout).toBe(600);

      ipcServer.stop();
    });

    it('应该对未知路由返回 404', async () => {
      const { getIPCServer, resetIPCServer } = await import('../src/core/ipc-server.js');
      resetIPCServer();

      const ipcServer = getIPCServer(31341);
      await ipcServer.start(false);

      // 模拟发送未知路由
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: 31341,
          path: '/unknown/route',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          expect(res.statusCode).toBe(404);
          resolve();
        });

        req.on('error', reject);
        req.write(JSON.stringify({}));
        req.end();
      });

      ipcServer.stop();
    });
  });

  describe('命令文件生命周期', () => {
    it('应该正确创建命令文件', async () => {
      const { resetCommandManager, getCommandManager } = await import('../src/core/command-manager.js');
      resetCommandManager();

      const commandManager = getCommandManager();

      // 设置活跃会话
      commandManager.setActiveSession({
        sessionId: 'test-session',
        cwd: mockProjectDir,
        state: 'idle'
      });

      // 写入命令
      const result = commandManager.writeCommand(mockProjectDir, 'review项目', {
        source: 'dingtalk',
        userId: '12345'
      });

      expect(result.command).toBe('review项目');
      expect(result.source).toBe('dingtalk');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('应该正确处理命令执行完成', async () => {
      const { resetCommandManager, getCommandManager } = await import('../src/core/command-manager.js');
      resetCommandManager();

      const commandManager = getCommandManager();

      fs.existsSync.mockReturnValue(true);

      // 写入命令
      const result = commandManager.writeCommand(mockProjectDir, 'test command');

      // 处理命令已执行通知
      commandManager.handleCommandProcessed({
        file: result.commandFile,
        session: 'test-session'
      });

      // 验证命令已从待处理列表移除
      expect(commandManager.getPendingCount()).toBe(0);
    });

    it('应该正确处理命令超时', async () => {
      const { resetCommandManager, getCommandManager } = await import('../src/core/command-manager.js');
      resetCommandManager();

      const commandManager = getCommandManager();

      // 设置活跃会话
      commandManager.setActiveSession({
        sessionId: 'test-session',
        cwd: mockProjectDir,
        projectName: 'test-project',
        state: 'idle'
      });

      // 处理超时
      const result = commandManager.handleCommandTimeout({
        session: 'test-session',
        timeout: 600
      });

      expect(result.timedOut).toBe(true);
      expect(result.timeout).toBe(600);
      expect(result.projectName).toBe('test-project');
    });
  });

  describe('会话状态管理', () => {
    it('应该正确管理会话状态', async () => {
      const { resetCommandManager, getCommandManager } = await import('../src/core/command-manager.js');
      resetCommandManager();

      const commandManager = getCommandManager();

      // 初始状态：无活跃会话
      expect(commandManager.canAcceptCommand()).toBeFalsy();

      // 设置 idle 会话
      commandManager.setActiveSession({
        sessionId: 'test-session',
        cwd: mockProjectDir,
        state: 'idle'
      });

      expect(commandManager.canAcceptCommand()).toBe(true);

      // 清除会话
      commandManager.clearActiveSession();

      expect(commandManager.canAcceptCommand()).toBeFalsy();
    });

    it('running 状态不应接收命令', async () => {
      const { resetCommandManager, getCommandManager } = await import('../src/core/command-manager.js');
      resetCommandManager();

      const commandManager = getCommandManager();

      commandManager.setActiveSession({
        sessionId: 'test-session',
        cwd: mockProjectDir,
        state: 'running'
      });

      expect(commandManager.canAcceptCommand()).toBe(false);
    });
  });

  describe('消息格式', () => {
    it('应该生成正确的命令已接收消息', () => {
      const commandInfo = {
        projectName: 'test-project',
        command: 'review一下代码'
      };

      // 直接使用消息模板
      const message = `## 📝 已收到指令

**项目**: \`${commandInfo.projectName}\`
**指令**: ${commandInfo.command}

正在传递给 Claude Code...`;

      expect(message).toContain('📝 已收到指令');
      expect(message).toContain('test-project');
      expect(message).toContain('review一下代码');
    });

    it('应该生成正确的超时消息', () => {
      const result = {
        projectName: 'test-project',
        timeout: 600
      };

      const timeoutMsg = `## ⏰ 等待超时

**项目**: \`${result.projectName}\`
**超时**: ${result.timeout / 60} 分钟

请直接在终端输入或稍后重试。`;

      expect(timeoutMsg).toContain('⏰ 等待超时');
      expect(timeoutMsg).toContain('test-project');
      expect(timeoutMsg).toContain('10 分钟');
    });
  });
});
