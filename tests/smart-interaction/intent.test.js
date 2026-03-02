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

  describe('System commands (- prefix)', () => {
    it('should parse -cd command', async () => {
      const intent = await parser.parse('-cd myproject');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('cd');
      expect(intent.params.args).toBe('myproject');
    });

    it('should parse -ls command', async () => {
      const intent = await parser.parse('-ls');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('ls');
    });

    it('should parse -claude command', async () => {
      const intent = await parser.parse('-claude');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('claude');
    });

    it('should parse -claude with task', async () => {
      const intent = await parser.parse('-claude 帮我写代码');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('claude');
      expect(intent.params.args).toBe('帮我写代码');
    });

    it('should parse -status command', async () => {
      const intent = await parser.parse('-status');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('status');
    });

    it('should parse -help command', async () => {
      const intent = await parser.parse('-help');
      expect(intent.type).toBe(IntentTypes.BUILT_IN);
      expect(intent.command).toBe('help');
    });
  });

  describe('Claude content (no - prefix)', () => {
    it('should parse /help as claude_command', async () => {
      const intent = await parser.parse('/help');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('/help');
    });

    it('should parse /commit as claude_command', async () => {
      const intent = await parser.parse('/commit');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('/commit');
    });

    it('should parse cd (without -) as claude_command', async () => {
      const intent = await parser.parse('cd src');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('cd src');
    });

    it('should parse ls (without -) as claude_command', async () => {
      const intent = await parser.parse('ls');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('ls');
    });

    it('should parse development request as claude_command', async () => {
      const intent = await parser.parse('帮我分析一下代码');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('帮我分析一下代码');
    });
  });

  describe('Confirmation (forwarded to Claude)', () => {
    it('should parse y as claude_command', async () => {
      const intent = await parser.parse('y');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('y');
    });

    it('should parse n as claude_command', async () => {
      const intent = await parser.parse('n');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('n');
    });
  });

  describe('Selection (forwarded to Claude)', () => {
    it('should parse number as claude_command', async () => {
      const intent = await parser.parse('2');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('2');
    });

    it('should parse Chinese number as claude_command', async () => {
      const intent = await parser.parse('第二个');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('第二个');
    });
  });

  describe('Shell commands (forwarded to Claude)', () => {
    it('should parse git status as claude_command', async () => {
      const intent = await parser.parse('git status');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('git status');
    });

    it('should parse npm install as claude_command', async () => {
      const intent = await parser.parse('npm install');
      expect(intent.type).toBe(IntentTypes.CLAUDE_COMMAND);
      expect(intent.command).toBe('npm install');
    });
  });
});
