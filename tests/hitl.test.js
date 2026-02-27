import { describe, it, expect } from 'vitest';
import { checkHitl, extractHitlPrompt, getHitlOptions } from '../src/purifier/hitl.js';

describe('hitl', () => {
  describe('checkHitl', () => {
    it('应该检测 (y/n) 提示', () => {
      expect(checkHitl('Do you want to continue? (y/n)')).toBe(true);
      expect(checkHitl('Continue? (Y/N)')).toBe(true);
      expect(checkHitl('Proceed? (yes/no)')).toBe(true);
    });

    it('应该检测 Allow 提示', () => {
      expect(checkHitl('Allow this operation?')).toBe(true);
      expect(checkHitl('Permission needed?')).toBe(true);
    });

    it('应该检测命令执行确认', () => {
      expect(checkHitl('Run this command?')).toBe(true);
      expect(checkHitl('Execute script?')).toBe(true);
    });

    it('应该检测 Git 确认', () => {
      expect(checkHitl('Commit changes?')).toBe(true);
      expect(checkHitl('Push to remote?')).toBe(true);
    });

    it('应该拒绝非 HITL 文本', () => {
      expect(checkHitl('Hello World')).toBe(false);
      expect(checkHitl('The file has been saved')).toBe(false);
      expect(checkHitl('npm install completed')).toBe(false);
    });
  });

  describe('extractHitlPrompt', () => {
    it('应该提取 HITL 提示内容', () => {
      const text = 'Some output before Do you want to continue? (y/n)';
      const prompt = extractHitlPrompt(text);
      expect(prompt).toContain('(y/n)');
    });

    it('应该返回 null 当没有 HITL 提示', () => {
      const text = 'Hello World';
      expect(extractHitlPrompt(text)).toBeNull();
    });

    it('应该返回 null 当输入为空', () => {
      expect(extractHitlPrompt('')).toBeNull();
      expect(extractHitlPrompt(null)).toBeNull();
    });
  });

  describe('getHitlOptions', () => {
    it('应该返回正确的默认选项', () => {
      const options = getHitlOptions();
      expect(options.approve).toBe('y');
      expect(options.reject).toBe('n');
    });
  });
});
