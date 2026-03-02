import { describe, it, expect, beforeAll } from 'vitest';

// Mock 环境变量，避免依赖真实 .env 文件
beforeAll(() => {
  process.env.DINGTALK_APP_KEY = process.env.DINGTALK_APP_KEY || 'mock_app_key';
  process.env.DINGTALK_APP_SECRET = process.env.DINGTALK_APP_SECRET || 'mock_app_secret';
  process.env.ALLOWED_ROOT_DIR = process.env.ALLOWED_ROOT_DIR || '/tmp/openhermit-test';
});

describe('集成测试：模拟钉钉消息流程', () => {
  describe('1. 配置模块测试', () => {
    it('应该能加载配置', async () => {
      const config = await import('../src/config/index.js');
      expect(config.getAllowedRootDir).toBeDefined();
    });

    it('应该能验证配置', async () => {
      const { validateConfig } = await import('../src/config/index.js');
      // 假设 .env 已正确配置
      const result = validateConfig();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('2. 净化器模块测试', () => {
    it('应该能导入净化函数', async () => {
      const stripper = await import('../src/purifier/stripper.js');
      expect(stripper.purify).toBeDefined();
      expect(stripper.stripAnsiCodes).toBeDefined();
    });

    it('应该能导入 HITL 检测函数', async () => {
      const hitl = await import('../src/purifier/hitl.js');
      expect(hitl.checkHitl).toBeDefined();
      expect(hitl.extractHitlPrompt).toBeDefined();
    });

    it('净化器应该去除 ANSI', async () => {
      const { purify } = await import('../src/purifier/stripper.js');
      const input = '\x1b[31mError\x1b[0m';
      expect(purify(input)).toBe('Error');
    });

    it('HITL 检测应该识别危险命令', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');
      expect(checkHitl('Run bash command? (y/n)')).toBe(true);
      expect(checkHitl('Delete file? (y/n)')).toBe(true);
      expect(checkHitl('Allow this command?')).toBe(true);
    });
  });

  describe('3. 环境变量构建测试', () => {
    it('应该能导入环境构建函数', async () => {
      const envBuild = await import('../src/pty/envBuild.js');
      expect(envBuild.buildEnv).toBeDefined();
    });

    it('buildEnv 应该返回包含 PATH 的对象', async () => {
      const { buildEnv } = await import('../src/pty/envBuild.js');
      const env = buildEnv();
      expect(env.PATH).toBeDefined();
    });
  });

  describe('4. 消息流程模拟', () => {
    it('模拟用户发送 /cd 命令', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      // 模拟 /cd 逻辑
      const targetPath = rootDir + '/my-project';
      const isAllowed = targetPath.startsWith(rootDir);

      expect(isAllowed).toBe(true);
    });

    it('模拟用户发送 /cd 到非法目录', async () => {
      const { getAllowedRootDir } = await import('../src/config/index.js');
      const rootDir = getAllowedRootDir();

      // 模拟 /cd 逻辑
      const targetPath = '/tmp/hack';
      const isAllowed = targetPath.startsWith(rootDir);

      expect(isAllowed).toBe(false);
    });

    it('模拟 PTY 输出净化流程', async () => {
      const { purify } = await import('../src/purifier/stripper.js');

      // 模拟 Claude Code 输出
      const rawOutput = `\x1b[32m✓\x1b[0m Analysis complete
⠋ Processing files...
Total: 5 files`;

      const cleanOutput = purify(rawOutput);

      expect(cleanOutput).toContain('✓ Analysis complete');
      expect(cleanOutput).toContain('Total: 5 files');
      expect(cleanOutput).not.toContain('\x1b');
      expect(cleanOutput).not.toContain('⠋');
    });

    it('模拟 HITL 检测流程', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');

      // 测试危险命令确认
      const dangerousOutput = `Running: rm -rf /
Delete this file? (y/n)`;

      const isHitl = checkHitl(dangerousOutput);
      expect(isHitl).toBe(true);
    });

    it('模拟普通文本（非 HITL）', async () => {
      const { checkHitl } = await import('../src/purifier/hitl.js');

      const output = `Here is the code:
function hello() {
  console.log('Hello World');
}`;

      const isHitl = checkHitl(output);
      expect(isHitl).toBe(false);
    });
  });

  describe('5. 分片逻辑测试', () => {
    it('应该正确计算分片', () => {
      const text = 'a'.repeat(5000);
      const maxChunkSize = 1950;

      const chunks = [];
      for (let i = 0; i < text.length; i += maxChunkSize) {
        chunks.push(text.slice(i, i + maxChunkSize));
      }

      expect(chunks.length).toBe(3);
    });

    it('应该生成正确的序号', () => {
      const totalChunks = 3;

      for (let i = 0; i < totalChunks; i++) {
        const header = `[${i + 1}/${totalChunks}]`;
        if (i === 0) expect(header).toBe('[1/3]');
        if (i === 1) expect(header).toBe('[2/3]');
        if (i === 2) expect(header).toBe('[3/3]');
      }
    });
  });

  describe('6. 日志模块测试', () => {
    it('应该能导入日志模块', async () => {
      const logger = await import('../src/utils/logger.js');
      expect(logger.default).toBeDefined();
    });
  });
});
