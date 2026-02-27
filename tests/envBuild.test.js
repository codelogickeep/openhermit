import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildEnv, getDefaultShell } from '../src/pty/envBuild.js';

describe('envBuild', () => {
  describe('buildEnv', () => {
    it('应该继承宿主机的环境变量', () => {
      const env = buildEnv();
      expect(env.PATH).toBeDefined();
      expect(env.HOME).toBeDefined();
    });

    it('应该注入 API Key（当提供时）', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key');
      const env = buildEnv();
      expect(env.ANTHROPIC_API_KEY).toBe('test-api-key');
      vi.unstubAllEnvs();
    });

    it('应该注入 Base URL（当提供时）', () => {
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://test.com/v1');
      const env = buildEnv();
      expect(env.ANTHROPIC_BASE_URL).toBe('https://test.com/v1');
      vi.unstubAllEnvs();
    });

    it('应该设置指定的工作目录', () => {
      const env = buildEnv({ cwd: '/test/path' });
      expect(env.PWD).toBe('/test/path');
      expect(env.TERM_PROGRAM).toBe('openhermit');
    });
  });

  describe('getDefaultShell', () => {
    it('应该返回默认 shell 路径', () => {
      const shell = getDefaultShell();
      expect(shell).toBeDefined();
      expect(typeof shell).toBe('string');
    });
  });
});
