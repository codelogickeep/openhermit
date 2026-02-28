import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMarkdownFormatter } from '../../src/formatter/index.js';
import { TerminalPatterns, detectPatterns, extractOptions } from '../../src/formatter/patterns.js';

// Mock LLM 客户端
vi.mock('../../src/llm/index.js', () => ({
  getLLMClient: () => ({
    isAvailable: () => false,
    formatOutput: vi.fn().mockResolvedValue('formatted')
  })
}));

describe('MarkdownFormatter', () => {
  let formatter;

  beforeEach(() => {
    formatter = getMarkdownFormatter();
  });

  describe('basicFormat', () => {
    it('should return empty string for empty input', () => {
      expect(formatter.basicFormat('')).toBe('');
    });

    it('should return empty string for whitespace only', () => {
      expect(formatter.basicFormat('   \n\n   ')).toBe('');
    });

    it('should compress multiple blank lines', () => {
      const input = 'line1\n\n\n\n\nline2';
      const result = formatter.basicFormat(input);
      expect(result).not.toContain('\n\n\n');
    });

    it('should truncate long output', () => {
      const longText = 'a'.repeat(5000);
      const result = formatter.basicFormat(longText);
      expect(result.length).toBeLessThan(5000);
      expect(result).toContain('截断');
    });
  });

  describe('filterTerminalDecorations', () => {
    it('should filter prompt decoration lines', () => {
      const input = '╭─ ~/project ────\ncontent\n╰─ ─╯';
      const result = formatter.filterTerminalDecorations(input);
      expect(result).not.toContain('╭─');
      expect(result).not.toContain('╰─');
      expect(result).toContain('content');
    });

    it('should filter empty prompt markers', () => {
      const input = 'content\n❯\nmore content';
      const result = formatter.filterTerminalDecorations(input);
      expect(result).not.toMatch(/^❯$/m);
    });

    it('should filter zsh prompt end marker', () => {
      const input = 'content\n%\nmore content';
      const result = formatter.filterTerminalDecorations(input);
      expect(result).not.toMatch(/^\s*%\s*$/m);
    });

    it('should filter user input echo', () => {
      const input = '❯ some command\noutput';
      const result = formatter.filterTerminalDecorations(input);
      expect(result).not.toContain('❯ some command');
    });

    it('should preserve normal content', () => {
      const input = 'normal line 1\nnormal line 2';
      const result = formatter.filterTerminalDecorations(input);
      expect(result).toContain('normal line 1');
      expect(result).toContain('normal line 2');
    });
  });

  describe('stripAnsi', () => {
    it('should remove ANSI escape sequences', () => {
      const input = '\x1b[31mred text\x1b[0m';
      const result = formatter.stripAnsi(input);
      expect(result).toBe('red text');
    });

    it('should remove ANSI cursor movements', () => {
      const input = 'text\x1b[2K\rmore';
      const result = formatter.stripAnsi(input);
      expect(result).not.toContain('\x1b[2K');
    });
  });

  describe('addStatusIcons', () => {
    it('should add error icon for error lines', () => {
      const patterns = { hasError: true };
      const input = 'Error: something failed';
      const result = formatter.addStatusIcons(input, patterns);
      expect(result).toContain('❌');
    });

    it('should add success icon for success lines', () => {
      const patterns = { hasSuccess: true };
      const input = 'Success: operation completed';
      const result = formatter.addStatusIcons(input, patterns);
      expect(result).toContain('✅');
    });

    it('should add warning icon for warning lines', () => {
      const patterns = { hasWarning: true };
      const input = 'Warning: check this';
      const result = formatter.addStatusIcons(input, patterns);
      expect(result).toContain('⚠️');
    });

    it('should not duplicate icons', () => {
      const patterns = { hasError: true };
      const input = '❌ Error: already has icon';
      const result = formatter.addStatusIcons(input, patterns);
      expect(result.match(/❌/g).length).toBe(1);
    });
  });

  describe('formatLinks', () => {
    it('should convert URLs to markdown links', () => {
      const input = 'Visit https://example.com for more';
      const result = formatter.formatLinks(input);
      expect(result).toContain('[https://example.com](https://example.com)');
    });
  });

  describe('truncate', () => {
    it('should not truncate short text', () => {
      const input = 'short text';
      const result = formatter.truncate(input);
      expect(result).toBe(input);
    });

    it('should truncate at newline boundary', () => {
      const input = 'a'.repeat(3000) + '\n' + 'b'.repeat(2000);
      const result = formatter.truncate(input);
      expect(result.length).toBeLessThan(input.length);
      expect(result).toContain('截断');
    });
  });
});

describe('TerminalPatterns', () => {
  it('should have required pattern definitions', () => {
    expect(TerminalPatterns.ansi).toBeDefined();
    expect(TerminalPatterns.link).toBeDefined();
    expect(TerminalPatterns.table).toBeDefined();
    expect(TerminalPatterns.list).toBeDefined();
    expect(TerminalPatterns.selection).toBeDefined();
    expect(TerminalPatterns.status).toBeDefined();
  });
});

describe('detectPatterns', () => {
  it('should detect code blocks', () => {
    const text = '    code here\n    more code';
    const patterns = detectPatterns(text);
    expect(patterns.hasCodeBlock).toBe(true);
  });

  it('should detect tables', () => {
    const text = '| Name | Age |\n|------|-----|';
    const patterns = detectPatterns(text);
    expect(patterns.hasTable).toBe(true);
  });

  it('should detect lists', () => {
    const text = '- Item 1\n- Item 2';
    const patterns = detectPatterns(text);
    expect(patterns.hasList).toBe(true);
  });

  it('should detect links', () => {
    const text = 'Visit https://example.com';
    const patterns = detectPatterns(text);
    expect(patterns.hasLinks).toBe(true);
  });

  it('should detect error patterns', () => {
    const text = 'Error: something went wrong';
    const patterns = detectPatterns(text);
    expect(patterns.hasError).toBe(true);
  });

  it('should detect selection prompts', () => {
    const text = '[1/3] Please select:';
    const patterns = detectPatterns(text);
    expect(patterns.hasSelection).toBe(true);
  });

  it('should calculate complexity score', () => {
    const simple = 'just text';
    const complex = '| table |\n```code```\n- list\nhttps://link.com';
    const simplePatterns = detectPatterns(simple);
    const complexPatterns = detectPatterns(complex);
    expect(complexPatterns.complexity).toBeGreaterThan(simplePatterns.complexity);
  });
});

describe('extractOptions', () => {
  it('should extract numbered options', () => {
    const text = `Please select:
1. Option A
2. Option B
3. Option C`;

    const options = extractOptions(text);
    expect(options.length).toBe(3);
    expect(options[0].index).toBe(1);
    expect(options[0].text).toBe('Option A');
  });

  it('should return empty array for no options', () => {
    const text = 'No options here';
    const options = extractOptions(text);
    expect(options.length).toBe(0);
  });
});
