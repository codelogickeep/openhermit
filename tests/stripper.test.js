import { describe, it, expect } from 'vitest';
import {
  stripAnsiCodes,
  filterControlChars,
  filterLoadingAnimations,
  purify
} from '../src/purifier/stripper.js';

describe('stripper', () => {
  describe('stripAnsiCodes', () => {
    it('应该去除 ANSI 颜色码', () => {
      const input = '\x1b[31m红色\x1b[0m';
      const output = stripAnsiCodes(input);
      expect(output).toBe('红色');
    });

    it('应该去除 ANSI 样式码', () => {
      const input = '\x1b[1;32m绿色加粗\x1b[0m';
      const output = stripAnsiCodes(input);
      expect(output).toBe('绿色加粗');
    });

    it('普通文本应该保持不变', () => {
      const input = 'Hello World';
      const output = stripAnsiCodes(input);
      expect(output).toBe('Hello World');
    });
  });

  describe('filterControlChars', () => {
    it('应该过滤退格符', () => {
      const input = 'hello\bworld';
      const output = filterControlChars(input);
      expect(output).not.toContain('\b');
    });

    it('应该保留换行符', () => {
      const input = 'hello\nworld';
      const output = filterControlChars(input);
      expect(output).toContain('\n');
    });

    it('应该去除独立回车符', () => {
      const input = 'hello\rworld';
      const output = filterControlChars(input);
      expect(output).not.toContain('\r');
    });

    it('应该过滤残留的 CSI 序列（如 [27m）', () => {
      const input = 'text[27mmore text';
      const output = filterControlChars(input);
      expect(output).toBe('textmore text');
    });

    it('应该过滤残留的多种 CSI 序列', () => {
      const input = '[0m[1m[32m[27mtext';
      const output = filterControlChars(input);
      expect(output).toBe('text');
    });

    it('应该保留正常的方括号内容', () => {
      const input = 'list[1] item[2]';
      const output = filterControlChars(input);
      expect(output).toBe('list[1] item[2]');
    });
  });

  describe('filterLoadingAnimations', () => {
    it('应该过滤转圈字符', () => {
      const input = '⠋ Loading...';
      const output = filterLoadingAnimations(input);
      expect(output).not.toContain('⠋');
    });

    it('应该保留普通文字', () => {
      const input = 'Hello World';
      const output = filterLoadingAnimations(input);
      expect(output).toBe('Hello World');
    });
  });

  describe('purify', () => {
    it('应该完整净化带颜色的文本', () => {
      const input = '\x1b[32m成功\x1b[0m\n';
      const output = purify(input);
      expect(output).toBe('成功\n');
    });

    it('应该移除多余空白行', () => {
      const input = 'line1\n\n\n\nline2';
      const output = purify(input);
      expect(output).toBe('line1\n\nline2');
    });

    it('应该返回空字符串当输入为空', () => {
      expect(purify('')).toBe('');
      expect(purify(null)).toBe('');
      expect(purify(undefined)).toBe('');
    });
  });
});
