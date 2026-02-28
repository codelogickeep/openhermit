import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSelectionDetector, getSelectionHandler } from '../../src/selector/index.js';
import { TerminalPatterns, detectPatterns, extractOptions } from '../../src/formatter/patterns.js';

// Mock LLM 客户端
vi.mock('../../src/llm/index.js', () => ({
  getLLMClient: () => ({
    isAvailable: () => false,
    parseSelection: vi.fn().mockResolvedValue(null),
    mapSelection: vi.fn().mockResolvedValue({ input: '1', method: 'number' }),
    formatOutput: vi.fn().mockResolvedValue('formatted')
  })
}));

describe('SelectionDetector', () => {
  let detector;

  beforeEach(() => {
    detector = getSelectionDetector();
    detector.clearLastSelection();
  });

  describe('Quick Detect', () => {
    it('should detect Claude Code selection [1/3]', async () => {
      const output = `[1/3] 请选择:
1. 创建新文件
2. 修改现有文件
3. 删除文件`;

      const result = await detector.detect(output);
      expect(result).not.toBeNull();
      expect(result.type).toBe('number');
      expect(result.options.length).toBe(3);
    });

    it('should detect y/n confirmation', async () => {
      const output = '是否继续? (y/n)';
      const result = await detector.detect(output);
      expect(result).not.toBeNull();
      expect(result.type).toBe('confirm');
    });

    it('should detect Allow confirmation', async () => {
      const output = 'Allow this action?';
      const result = await detector.detect(output);
      expect(result).not.toBeNull();
      expect(result.type).toBe('confirm');
    });

    it('should detect numbered options', async () => {
      const output = `请选择一个选项:
1. 选项A
2. 选项B
3. 选项C`;

      const result = await detector.detect(output);
      expect(result).not.toBeNull();
      expect(result.type).toBe('number');
      expect(result.options.length).toBe(3);
    });

    it('should return null for non-selection text', async () => {
      const output = '这是一段普通的文本输出';
      const result = await detector.detect(output);
      expect(result).toBeNull();
    });
  });

  describe('Format Selection Prompt', () => {
    it('should format number selection correctly', () => {
      const selection = {
        type: 'number',
        options: [
          { index: 1, text: '选项A', isDefault: true },
          { index: 2, text: '选项B', isDefault: false }
        ]
      };

      const formatted = detector.formatSelectionPrompt(selection);
      expect(formatted).toContain('📍 请选择');
      expect(formatted).toContain('1️⃣');
      expect(formatted).toContain('选项A');
      expect(formatted).toContain('默认');
    });

    it('should format confirm selection correctly', () => {
      const selection = {
        type: 'confirm',
        options: [
          { index: 1, text: 'Yes' },
          { index: 2, text: 'No' }
        ]
      };

      const formatted = detector.formatSelectionPrompt(selection);
      expect(formatted).toContain('y(同意)');
      expect(formatted).toContain('n(拒绝)');
    });
  });
});

describe('SelectionHandler', () => {
  let handler;

  beforeEach(() => {
    handler = getSelectionHandler();
  });

  describe('Number Selection', () => {
    const selection = {
      type: 'number',
      options: [
        { index: 1, text: '选项A' },
        { index: 2, text: '选项B' },
        { index: 3, text: '选项C' }
      ]
    };

    it('should handle direct number', async () => {
      const result = await handler.handle(selection, '2');
      expect(result.input).toBe('2');
      expect(result.method).toBe('number');
    });

    it('should handle Chinese number', async () => {
      const result = await handler.handle(selection, '第二个');
      expect(result.input).toBe('2');
      expect(result.method).toBe('number');
    });
  });

  describe('Confirm Selection', () => {
    const selection = {
      type: 'confirm',
      options: []
    };

    it('should handle yes', async () => {
      const result = await handler.handle(selection, 'y');
      expect(result.input).toBe('y');
      expect(result.method).toBe('confirm');
    });

    it('should handle no', async () => {
      const result = await handler.handle(selection, 'n');
      expect(result.input).toBe('n');
      expect(result.method).toBe('confirm');
    });

    it('should handle Chinese yes', async () => {
      const result = await handler.handle(selection, '是');
      expect(result.input).toBe('y');
    });
  });

  describe('Arrow Selection', () => {
    const selection = {
      type: 'arrow',
      options: [
        { index: 1, text: 'A', isDefault: true },
        { index: 2, text: 'B', isDefault: false },
        { index: 3, text: 'C', isDefault: false }
      ]
    };

    it('should handle /up command', async () => {
      const result = await handler.handle(selection, '/up');
      expect(result.input).toBe('\x1b[A');
      expect(result.method).toBe('arrow');
    });

    it('should handle /down command', async () => {
      const result = await handler.handle(selection, '/down');
      expect(result.input).toBe('\x1b[B');
      expect(result.method).toBe('arrow');
    });
  });
});

describe('Pattern Detection', () => {
  it('should detect code blocks', () => {
    const text = '    code here\n    more code';
    const patterns = detectPatterns(text);
    expect(patterns.hasCodeBlock).toBe(true);
  });

  it('should detect tables', () => {
    const text = '| Name | Age |\n|------|-----|\n| John | 25  |';
    const patterns = detectPatterns(text);
    expect(patterns.hasTable).toBe(true);
  });

  it('should detect lists', () => {
    const text = '- Item 1\n- Item 2';
    const patterns = detectPatterns(text);
    expect(patterns.hasList).toBe(true);
  });

  it('should detect links', () => {
    const text = 'Visit https://example.com for more info';
    const patterns = detectPatterns(text);
    expect(patterns.hasLinks).toBe(true);
  });

  it('should detect error messages', () => {
    const text = 'Error: Something went wrong';
    const patterns = detectPatterns(text);
    expect(patterns.hasError).toBe(true);
  });
});

describe('Extract Options', () => {
  it('should extract numbered options', () => {
    const text = `请选择:
1. 创建新文件
2. 修改现有文件
3. 删除文件`;

    const options = extractOptions(text);
    expect(options.length).toBe(3);
    expect(options[0].index).toBe(1);
    expect(options[0].text).toBe('创建新文件');
  });
});
