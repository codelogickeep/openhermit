/**
 * CommandManager 模块测试
 * 测试双向通信的命令管理功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resetCommandManager, getCommandManager } from '../src/core/command-manager.js';

// Mock fs module
vi.mock('fs');

describe('CommandManager 模块', () => {
  let commandManager;
  let mockProjectDir;
  let mockCommandDir;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCommandManager();
    commandManager = getCommandManager();

    mockProjectDir = '/test/project';
    mockCommandDir = path.join(mockProjectDir, '.claude', '.openhermit', 'commands');

    // Mock fs methods
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockImplementation(() => {});
    fs.writeFileSync.mockImplementation(() => {});
    fs.unlinkSync.mockImplementation(() => {});
    fs.readdirSync.mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetModules();
    resetCommandManager();
  });

  describe('会话管理', () => {
    it('应该正确设置活跃会话', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        projectName: 'test-project',
        state: 'idle',
        timestamp: Date.now()
      };

      commandManager.setActiveSession(session);

      expect(commandManager.getActiveSession()).toEqual(session);
    });

    it('应该正确清除活跃会话', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        state: 'idle'
      };

      commandManager.setActiveSession(session);
      commandManager.clearActiveSession();

      expect(commandManager.getActiveSession()).toBeNull();
    });

    it('应该在会话状态为 idle 时允许接收命令', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        state: 'idle'
      };

      commandManager.setActiveSession(session);

      expect(commandManager.canAcceptCommand()).toBe(true);
    });

    it('应该在会话状态为 running 时拒绝接收命令', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        state: 'running'
      };

      commandManager.setActiveSession(session);

      expect(commandManager.canAcceptCommand()).toBe(false);
    });

    it('应该在无活跃会话时拒绝接收命令', () => {
      expect(commandManager.canAcceptCommand()).toBeFalsy();
    });
  });

  describe('命令写入', () => {
    beforeEach(() => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        state: 'idle'
      };
      commandManager.setActiveSession(session);
    });

    it('应该正确写入命令文件', () => {
      const command = 'review一下当前项目';
      const meta = { source: 'dingtalk', userId: '12345' };

      const result = commandManager.writeCommand(mockProjectDir, command, meta);

      expect(result.commandId).toBeDefined();
      expect(result.command).toBe(command);
      expect(result.projectDir).toBe(mockProjectDir);
      expect(result.source).toBe('dingtalk');
      expect(result.userId).toBe('12345');
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockCommandDir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('应该使用时间戳作为命令 ID', () => {
      const command = 'test command';

      const result = commandManager.writeCommand(mockProjectDir, command);

      expect(result.commandId).toMatch(/^\d+$/);
    });

    it('应该去除命令内容的首尾空白', () => {
      const command = '  test command  ';

      const result = commandManager.writeCommand(mockProjectDir, command);

      expect(result.command).toBe('test command');
    });

    it('应该记录待处理命令', () => {
      const command = 'test command';

      commandManager.writeCommand(mockProjectDir, command);

      expect(commandManager.getPendingCount()).toBe(1);
    });

    it('应该在写入失败时抛出错误', () => {
      fs.mkdirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => {
        commandManager.writeCommand(mockProjectDir, 'test');
      }).toThrow('Permission denied');
    });
  });

  describe('命令删除', () => {
    it('应该正确删除存在的命令文件', () => {
      const commandFile = path.join(mockCommandDir, '1234567890.txt');
      fs.existsSync.mockReturnValue(true);

      commandManager.removeCommand(commandFile);

      expect(fs.unlinkSync).toHaveBeenCalledWith(commandFile);
    });

    it('应该在文件不存在时跳过删除', () => {
      const commandFile = path.join(mockCommandDir, '1234567890.txt');
      fs.existsSync.mockReturnValue(false);

      commandManager.removeCommand(commandFile);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it('应该从待处理列表中移除已删除的命令', () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockImplementation(() => {});

      // 先写入一个命令
      const result = commandManager.writeCommand(mockProjectDir, 'test command');
      expect(commandManager.getPendingCount()).toBe(1);

      // 删除命令
      commandManager.removeCommand(result.commandFile);
      expect(commandManager.getPendingCount()).toBe(0);
    });
  });

  describe('过期命令清理', () => {
    it('应该清理过期的命令文件', () => {
      const now = Date.now();
      const oldFile = `${now - 1200000}.txt`; // 20 分钟前
      const newFile = `${now - 60000}.txt`;   // 1 分钟前

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([oldFile, newFile]);

      commandManager.cleanupExpiredCommands(mockProjectDir, 600000); // 10 分钟过期

      // 只应该删除旧文件
      expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(mockCommandDir, oldFile));
    });

    it('应该在目录不存在时跳过清理', () => {
      fs.existsSync.mockReturnValue(false);

      commandManager.cleanupExpiredCommands(mockProjectDir);

      expect(fs.readdirSync).not.toHaveBeenCalled();
    });
  });

  describe('命令处理回调', () => {
    it('应该正确处理命令已执行通知', () => {
      fs.writeFileSync.mockImplementation(() => {});

      const result = commandManager.writeCommand(mockProjectDir, 'test command');
      expect(commandManager.getPendingCount()).toBe(1);

      commandManager.handleCommandProcessed({
        file: result.commandFile,
        session: 'test-session'
      });

      expect(commandManager.getPendingCount()).toBe(0);
    });

    it('应该调用 onCommandProcessed 回调', () => {
      fs.writeFileSync.mockImplementation(() => {});

      const callback = vi.fn();
      commandManager.onCommandProcessed = callback;

      const result = commandManager.writeCommand(mockProjectDir, 'test command');

      commandManager.handleCommandProcessed({
        file: result.commandFile,
        session: 'test-session'
      });

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        commandId: result.commandId,
        command: 'test command'
      }));
    });

    it('应该正确处理超时通知', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        projectName: 'test-project',
        state: 'idle'
      };
      commandManager.setActiveSession(session);

      const result = commandManager.handleCommandTimeout({
        session: 'test-session-123',
        timeout: 600
      });

      expect(result.timedOut).toBe(true);
      expect(result.timeout).toBe(600);
    });

    it('应该调用 onTimeout 回调', () => {
      const session = {
        sessionId: 'test-session-123',
        cwd: mockProjectDir,
        projectName: 'test-project',
        state: 'idle'
      };
      commandManager.setActiveSession(session);

      const callback = vi.fn();
      commandManager.onTimeout = callback;

      commandManager.handleCommandTimeout({
        session: 'test-session-123',
        timeout: 600
      });

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        timedOut: true,
        timeout: 600
      }));
    });
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const instance1 = getCommandManager();
      const instance2 = getCommandManager();

      expect(instance1).toBe(instance2);
    });

    it('resetCommandManager 应该重置实例', () => {
      const instance1 = getCommandManager();
      instance1.setActiveSession({ cwd: '/test' });

      resetCommandManager();

      const instance2 = getCommandManager();
      expect(instance2).not.toBe(instance1);
      expect(instance2.getActiveSession()).toBeNull();
    });
  });
});
