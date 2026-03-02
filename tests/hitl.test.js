import { describe, it, expect } from 'vitest';
import { checkHitl, extractHitlPrompt, getHitlOptions } from '../src/purifier/hitl.js';

describe('hitl', () => {
  describe('checkHitl', () => {
    it('应该检测 (y/n) + 危险命令 提示', () => {
      expect(checkHitl('Run bash command? (y/n)')).toBe(true);
      expect(checkHitl('Execute this command? (Y/N)')).toBe(true);
      expect(checkHitl('Delete file? (y/n)')).toBe(true);
      expect(checkHitl('Remove file? (Y/N)')).toBe(true);
    });

    it('应该检测 Allow 提示', () => {
      expect(checkHitl('Allow this bash command?')).toBe(true);
      expect(checkHitl('Allow this command?')).toBe(true);
      expect(checkHitl('Allow execute operation?')).toBe(true);
      expect(checkHitl('Allow delete file?')).toBe(true);
    });

    it('应该检测命令执行确认', () => {
      expect(checkHitl('Run this command?')).toBe(true);
      expect(checkHitl('Execute this command?')).toBe(true);
    });

    it('应该检测文件操作确认', () => {
      expect(checkHitl('Delete file?')).toBe(true);
      expect(checkHitl('Remove file?')).toBe(true);
      expect(checkHitl('Overwrite file?')).toBe(true);
    });

    it('应该拒绝非 HITL 文本', () => {
      expect(checkHitl('Hello World')).toBe(false);
      expect(checkHitl('The file has been saved')).toBe(false);
      expect(checkHitl('npm install completed')).toBe(false);
      expect(checkHitl('Do you want to proceed?')).toBe(false);
      expect(checkHitl('Continue?')).toBe(false);
    });

    it('应该拒绝普通选项选择（不是 HITL）', () => {
      expect(checkHitl('Do you want to continue? (y/n)')).toBe(false);
      expect(checkHitl('Proceed?')).toBe(false);
      expect(checkHitl('Are you sure?')).toBe(false);
    });
  });

  describe('extractHitlPrompt', () => {
    it('应该提取 HITL 提示内容', () => {
      const text = 'Some output before Run this command? (y/n)';
      const prompt = extractHitlPrompt(text);
      expect(prompt).toBeTruthy();
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
