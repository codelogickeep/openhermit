import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentTypes, SessionState, getIntentParser } from '../../src/intent/index.js';

// Mock LLM 客户端
vi.mock('../../src/llm/index.js', () => ({
  getLLMClient: () => ({
    isAvailable: () => false,
    parseIntent: vi.fn().mockResolvedValue({
      type: 'claude_command',
      command: 'test',
      params: {},
      confidence: 0.8
    }),
    mapSelection: vi.fn().mockResolvedValue({ input: '1', method: 'number' })
  })
}));

describe('IntentTypes', () => {
  it('should have all required types', () => {
    expect(IntentTypes.CLAUDE_COMMAND).toBe('claude_command');
    expect(IntentTypes.SHELL_COMMAND).toBe('shell_command');
    expect(IntentTypes.BUILT_IN).toBe('built_in');
    expect(IntentTypes.CONVERSATION).toBe('conversation');
  });
});

describe('SessionState', () => {
  let session;

  beforeEach(() => {
    session = new SessionState();
  });

  it('should start in idle mode', () => {
    expect(session.mode).toBe('idle');
  });

  it('should change mode correctly', () => {
    session.setMode('claude_active');
    expect(session.mode).toBe('claude_active');
  });

  it('should handle selection state', () => {
    const options = [{ index: 1, text: 'Option 1' }];
    session.setSelection(options, 'test context');
    expect(session.mode).toBe('waiting_selection');
    expect(session.selectionOptions).toEqual(options);
    expect(session.isWaitingSelection()).toBe(true);
  });

  it('should clear selection correctly', () => {
    session.setSelection([{ index: 1, text: 'Test' }], 'test');
    session.clearSelection();
    expect(session.selectionOptions).toEqual([]);
  });
});

describe('IntentParser - Quick Parse', () => {
  let parser;

  beforeEach(() => {
    parser = getIntentParser();
    parser.resetSession();
  });

  describe('Built-in commands', () => {
    it('should parse /cd command', async () => {
      const intent = await parser.parse('/cd myproject');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('/cd');
      expect(intent.params.path).toBe('myproject');
      expect(intent.confidence).toBe(1.0);
    });

    it('should parse /ls command', async () => {
      const intent = await parser.parse('/ls');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('/ls');
    });

    it('should parse /restart command', async () => {
      const intent = await parser.parse('/restart');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('/restart');
    });
  });

  describe('Confirmation', () => {
    it('should parse y as confirm', async () => {
      const intent = await parser.parse('y');
      expect(intent.type).toBe(IntentTypes.CONVERSATION);
      expect(intent.command).toBe('confirm');
      expect(intent.params.value).toBe('y');
    });

    it('should parse n as confirm', async () => {
      const intent = await parser.parse('n');
      expect(intent.type).toBe(IntentTypes.CONVERSATION);
      expect(intent.params.value).toBe('n');
    });
  });

  describe('Selection', () => {
    it('should parse number as selection', async () => {
      const intent = await parser.parse('2');
      expect(intent.type).toBe(IntentTypes.CONVERSATION);
      expect(intent.command).toBe('select');
      expect(intent.params.choice).toBe(2);
    });

    it('should parse Chinese number as selection', async () => {
      const intent = await parser.parse('第二个');
      expect(intent.type).toBe(IntentTypes.CONVERSATION);
      expect(intent.params.choice).toBe(2);
    });
  });

  describe('Shell commands', () => {
    it('should parse ls as shell command', async () => {
      const intent = await parser.parse('ls');
      expect(intent.type).toBe(IntentTypes.SHELL_COMMAND);
      expect(intent.command).toBe('ls');
    });

    it('should parse git status as shell command', async () => {
      const intent = await parser.parse('git status');
      expect(intent.type).toBe(IntentTypes.SHELL_COMMAND);
    });
  });

  describe('Claude commands', () => {
    it('should parse development request as claude command', async () => {
      const intent = await parser.parse('帮我分析一下代码');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
    });

    it('should parse explicit claude command', async () => {
      const intent = await parser.parse('claude 开始工作');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.params.explicit).toBe(true);
    });
  });
});
