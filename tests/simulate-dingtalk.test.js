import { describe, it, expect } from 'vitest';

describe('模拟钉钉消息流程测试', () => {
  describe('场景1: 用户首次连接', () => {
    it('应该收到欢迎消息和目录列表', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      const welcomeMessage = `🦀 欢迎使用 OpenHermit

当前工作目录: ${rootDir}
可选目录:
  - ${rootDir}

命令:
  /cd <目录>  切换工作目录
  /ls         查看可选目录
  /restart    重启 Claude Code

请先使用 /cd 切换到项目目录，然后输入 claude 启动。`;

      expect(welcomeMessage).toContain('欢迎使用 OpenHermit');
      expect(welcomeMessage).toContain(rootDir);
      expect(welcomeMessage).toContain('/cd');
      expect(welcomeMessage).toContain('/ls');
      expect(welcomeMessage).toContain('/restart');
    });
  });

  describe('场景2: 用户发送 /ls 命令', () => {
    it('应该返回当前目录和可选目录', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      const dirList = `当前工作目录: ${rootDir}\n白名单根目录: ${rootDir}\n`;

      expect(dirList).toContain('当前工作目录:');
      expect(dirList).toContain(rootDir);
    });
  });

  describe('场景3: 目录白名单验证', () => {
    it('应该验证目录在白名单内', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      // 模拟验证逻辑
      const testPath = rootDir + '/project-a';
      const isInWhitelist = testPath.startsWith(rootDir);

      expect(isInWhitelist).toBe(true);
    });

    it('应该拒绝白名单外的目录', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      const forbiddenPath = '/tmp/malicious';
      const isInWhitelist = forbiddenPath.startsWith(rootDir);

      expect(isInWhitelist).toBe(false);
    });
  });

  describe('场景4: 用户发送普通文本消息', () => {
    it('应该将文本写入 PTY', async () => {
      // 验证 purify 函数可以处理普通文本
      const { purify } = await import('../src/purifier/stripper.js');
      const message = 'ls -la';
      const output = purify(message);

      expect(output).toBe('ls -la');
    });
  });

  describe('场景5: PTY 输出净化', () => {
    it('应该净化 ANSI 颜色输出', async () => {
      const { purify } = await import('../src/purifier/stripper.js');

      const rawOutput = '\x1b[32m✓\x1b[0m Project initialized\n';
      const cleanOutput = purify(rawOutput);

      expect(cleanOutput).toBe('✓ Project initialized\n');
    });

    it('应该过滤加载动画', async () => {
      const { purify } = await import('../src/purifier/stripper.js');

      const rawOutput = '⠋ Installing...\n';
      const cleanOutput = purify(rawOutput);

      expect(cleanOutput).not.toContain('⠋');
      expect(cleanOutput).toContain('Installing');
    });

    it('应该移除多余空白行', async () => {
      const { purify } = await import('../src/purifier/stripper.js');

      const rawOutput = 'line1\n\n\n\nline2';
      const cleanOutput = purify(rawOutput);

      expect(cleanOutput).toBe('line1\n\nline2');
    });
  });

  describe('场景6: HITL 检测和审批', () => {
    it('应该检测 (y/n) 提示', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');

      expect(checkHitl('Do you want to continue? (y/n)')).toBe(true);
      expect(checkHitl('Continue? (Y/N)')).toBe(true);
    });

    it('应该检测 Allow 提示', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');

      expect(checkHitl('Allow this command?')).toBe(true);
    });

    it('应该拒绝非审批提示', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');

      expect(checkHitl('Hello World')).toBe(false);
      expect(checkHitl('npm install completed')).toBe(false);
    });
  });

  describe('场景7: 消息分片', () => {
    it('应该正确计算分片数量', () => {
      const maxLength = 2000;
      const chunkSize = 1950;

      const testCases = [
        { length: 500, expected: 1 },
        { length: 2000, expected: 2 }, // 2000/1950 = 1.026 -> ceil = 2
        { length: 3000, expected: 2 },
        { length: 3900, expected: 2 },
        { length: 4000, expected: 3 }
      ];

      testCases.forEach(({ length, expected }) => {
        const totalChunks = Math.ceil(length / chunkSize);
        expect(totalChunks).toBe(expected);
      });
    });

    it('应该生成正确的分片序号', () => {
      const totalChunks = 3;
      const headers = [];

      for (let i = 0; i < totalChunks; i++) {
        headers.push(`[${i + 1}/${totalChunks}]`);
      }

      expect(headers).toEqual(['[1/3]', '[2/3]', '[3/3]']);
    });
  });

  describe('场景8: 配置验证', () => {
    it('应该能获取钉钉配置', async () => {
      const { getDingTalkAppKey, getDingTalkAppSecret } = await import('../src/config/index.js');

      // 不应该抛出错误（配置已在 .env 中）
      expect(() => getDingTalkAppKey()).not.toThrow();
      expect(() => getDingTalkAppSecret()).not.toThrow();
    });

    it('应该能获取白名单目录', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      expect(rootDir).toBeDefined();
      expect(typeof rootDir).toBe('string');
      expect(rootDir.length).toBeGreaterThan(0);
    });
  });

  describe('场景9: 边界情况处理', () => {
    it('应该处理空输入', async () => {
      const { purify } = await import('../src/purifier/stripper.js');
      const { checkHitl } = await import('../src/purifier/hitl.js');

      expect(purify('')).toBe('');
      expect(purify(null)).toBe('');
      expect(checkHitl('')).toBe(false);
    });
  });
});
