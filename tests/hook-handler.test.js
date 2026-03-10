import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock LLM client
vi.mock('../src/llm/client.js', () => ({
  getLLMClient: () => ({
    isAvailable: () => false,
    chat: vi.fn().mockResolvedValue('{}')
  })
}));

// Mock hook context
vi.mock('../src/core/hook-context.js', () => ({
  getHookContext: () => ({
    set: vi.fn(),
    get: vi.fn().mockReturnValue(null),
    clear: vi.fn()
  })
}));

import { HookHandler, InteractionState, getHookHandler, resetHookHandler } from '../src/core/hook-handler.js';

describe('HookHandler', () => {
  let handler;

  beforeEach(() => {
    resetHookHandler();
    handler = new HookHandler();
  });

  describe('构造函数', () => {
    it('初始状态应该是 IDLE', () => {
      expect(handler.getState()).toBe(InteractionState.IDLE);
    });

    it('初始回调应该为 null', () => {
      expect(handler.onStateChange).toBeNull();
      expect(handler.onSendMessage).toBeNull();
    });
  });

  describe('setCallbacks()', () => {
    it('应该设置回调函数', () => {
      const onStateChange = vi.fn();
      const onSendMessage = vi.fn();

      handler.setCallbacks({ onStateChange, onSendMessage });

      expect(handler.onStateChange).toBe(onStateChange);
      expect(handler.onSendMessage).toBe(onSendMessage);
    });
  });

  describe('setState()', () => {
    it('应该更新状态', () => {
      handler.setState(InteractionState.RUNNING);
      expect(handler.getState()).toBe(InteractionState.RUNNING);
    });

    it('状态变化时应该触发回调', () => {
      const onStateChange = vi.fn();
      handler.setCallbacks({ onStateChange });

      handler.setState(InteractionState.RUNNING);

      expect(onStateChange).toHaveBeenCalledWith(InteractionState.RUNNING, InteractionState.IDLE);
    });

    it('状态不变时不应触发回调', () => {
      const onStateChange = vi.fn();
      handler.setCallbacks({ onStateChange });

      handler.setState(InteractionState.IDLE);

      expect(onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('handlePreToolUse()', () => {
    it('应该切换到 WAITING_CONFIRM 状态', async () => {
      const data = {
        session_id: 'test-session',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      };

      await handler.handlePreToolUse(data);

      expect(handler.getState()).toBe(InteractionState.WAITING_CONFIRM);
    });

    it('应该发送确认消息', async () => {
      const onSendMessage = vi.fn();
      handler.setCallbacks({ onSendMessage });

      const data = {
        session_id: 'test-session',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      };

      await handler.handlePreToolUse(data);

      expect(onSendMessage).toHaveBeenCalled();
      const call = onSendMessage.mock.calls[0][0];
      expect(call.type).toBe('confirmation');
      expect(call.message).toContain('Bash');
    });
  });

  describe('handleNotification()', () => {
    it('idle 通知应该切换到 WAITING_INPUT 状态', async () => {
      const data = {
        session_id: 'test-session',
        notification: { message: 'waiting for input' }
      };

      await handler.handleNotification(data);

      expect(handler.getState()).toBe(InteractionState.WAITING_INPUT);
    });

    it('应该发送等待输入消息', async () => {
      const onSendMessage = vi.fn();
      handler.setCallbacks({ onSendMessage });

      const data = {
        session_id: 'test-session',
        notification: { message: 'waiting for input' }
      };

      await handler.handleNotification(data);

      expect(onSendMessage).toHaveBeenCalled();
      const call = onSendMessage.mock.calls[0][0];
      expect(call.type).toBe('waiting_input');
    });
  });

  describe('handleStop()', () => {
    it('应该切换到 COMPLETED 状态', async () => {
      const data = {
        session_id: 'test-session',
        stop_reason: 'end_turn'
      };

      await handler.handleStop(data);

      expect(handler.getState()).toBe(InteractionState.COMPLETED);
    });

    it('应该发送完成消息', async () => {
      const onSendMessage = vi.fn();
      handler.setCallbacks({ onSendMessage });

      const data = {
        session_id: 'test-session',
        stop_reason: 'end_turn'
      };

      await handler.handleStop(data);

      expect(onSendMessage).toHaveBeenCalled();
      const call = onSendMessage.mock.calls[0][0];
      expect(call.type).toBe('completed');
      expect(call.message).toContain('✅');
    });
  });

  describe('getNotificationType()', () => {
    it('应该识别 idle 类型', () => {
      const result = handler.getNotificationType({ message: 'waiting for input' });
      expect(result).toBe('idle');
    });

    it('应该识别 permission 类型', () => {
      const result = handler.getNotificationType({ message: 'permission required' });
      expect(result).toBe('permission');
    });

    it('null 应该返回 unknown', () => {
      const result = handler.getNotificationType(null);
      expect(result).toBe('unknown');
    });
  });

  describe('generateSimplePreToolMessage()', () => {
    it('应该生成 Bash 命令消息', () => {
      const event = {
        toolName: 'Bash',
        toolInput: { command: 'ls -la' }
      };

      const message = handler.generateSimplePreToolMessage(event);

      expect(message).toContain('Bash');
      expect(message).toContain('ls -la');
      expect(message).toContain('确认');
    });

    it('应该生成文件操作消息', () => {
      const event = {
        toolName: 'Edit',
        toolInput: { file_path: '/path/to/file.js' }
      };

      const message = handler.generateSimplePreToolMessage(event);

      expect(message).toContain('Edit');
      expect(message).toContain('/path/to/file.js');
    });
  });

  describe('fallbackParseReply()', () => {
    it('应该解析 y 确认', () => {
      const result = handler.fallbackParseReply('y', {});
      expect(result.input).toBe('y');
      expect(result.feedback).toContain('确认');
    });

    it('应该解析 n 拒绝', () => {
      const result = handler.fallbackParseReply('n', {});
      expect(result.input).toBe('n');
      expect(result.feedback).toContain('拒绝');
    });

    it('应该解析中文确认', () => {
      const result = handler.fallbackParseReply('确认', {});
      expect(result.input).toBe('y');
    });

    it('应该解析数字选择', () => {
      const result = handler.fallbackParseReply('2', {});
      expect(result.input).toBe('2');
    });
  });

  describe('formatPreToolResult()', () => {
    it('应该格式化结果消息', () => {
      const result = {
        title: '执行命令',
        description: '测试描述',
        risk: 'medium',
        suggestion: '建议内容'
      };

      const message = handler.formatPreToolResult(result);

      expect(message).toContain('执行命令');
      expect(message).toContain('测试描述');
      expect(message).toContain('风险');
      expect(message).toContain('建议');
    });

    it('高风险应该显示红色标识', () => {
      const result = { risk: 'high' };
      const message = handler.formatPreToolResult(result);
      expect(message).toContain('🔴');
    });

    it('中风险应该显示黄色标识', () => {
      const result = { risk: 'medium' };
      const message = handler.formatPreToolResult(result);
      expect(message).toContain('🟡');
    });
  });

  describe('reset()', () => {
    it('应该重置状态到 IDLE', () => {
      handler.setState(InteractionState.RUNNING);
      handler.reset();
      expect(handler.getState()).toBe(InteractionState.IDLE);
    });
  });

  describe('单例模式', () => {
    it('getHookHandler 应该返回单例', () => {
      const instance1 = getHookHandler();
      const instance2 = getHookHandler();
      expect(instance1).toBe(instance2);
    });

    it('resetHookHandler 应该重置单例', () => {
      const instance1 = getHookHandler();
      resetHookHandler();
      const instance2 = getHookHandler();
      expect(instance1).not.toBe(instance2);
    });
  });
});
