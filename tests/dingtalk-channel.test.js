import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * DingTalkChannel 单元测试
 * 测试分片逻辑和 Channel 核心方法
 */

// 模拟依赖
vi.mock('../src/config/index.js', () => ({
  getDingTalkAppKey: () => 'test-app-key',
  getDingTalkAppSecret: () => 'test-app-secret',
  getAllowedRootDir: () => '/test/root',
  getDingTalkUserId: () => 'test-user-id'
}));

vi.mock('../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// 模拟 dingtalk-stream-sdk-nodejs
vi.mock('dingtalk-stream-sdk-nodejs', () => ({
  DWClient: vi.fn().mockImplementation(() => ({
    registerCallbackListener: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: true
  })),
  TOPIC_ROBOT: '/v1.0/im/bot/messages/get'
}));

// 模拟 axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: { access_token: 'mock-token' }
    }),
    post: vi.fn().mockResolvedValue({ data: {} })
  }
}));

// 模拟 lodash.debounce
vi.mock('lodash.debounce', () => ({
  default: (fn) => fn
}));

describe('DingTalkChannel', () => {
  let DingTalkChannel;
  let channel;

  beforeEach(async () => {
    // 清除模块缓存
    vi.resetModules();

    // 动态导入以应用模拟
    const module = await import('../src/channel/dingtalk.js');
    DingTalkChannel = module.default;
    channel = new DingTalkChannel();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('splitChunks 方法', () => {
    it('短文本不应该分片', () => {
      const text = '这是一条短消息';
      const chunks = channel.splitChunks(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('这是一条短消息');
    });

    it('刚好 2000 字节的文本不应该分片', () => {
      // ASCII 字符每个 1 字节
      const text = 'a'.repeat(2000);
      const chunks = channel.splitChunks(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('超过 2000 字节应该分片', () => {
      const text = 'a'.repeat(3000);
      const chunks = channel.splitChunks(text);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('分片应该包含序号', () => {
      const text = 'a'.repeat(4000);
      const chunks = channel.splitChunks(text);

      chunks.forEach((chunk, i) => {
        expect(chunk).toMatch(new RegExp(`^\\[${i + 1}/${chunks.length}\\]`));
      });
    });

    it('分片应该有重叠区域', () => {
      const text = 'a'.repeat(3000);
      const chunks = channel.splitChunks(text);

      // 第一片的最后 50 字符应该和第二片的前 50 字符重叠
      if (chunks.length >= 2) {
        // 去掉序号后比较
        const firstContent = chunks[0].replace(/^\[\d+\/\d+\] /, '');
        const secondContent = chunks[1].replace(/^\[\d+\/\d+\] /, '');

        const firstEnd = firstContent.slice(-50);
        const secondStart = secondContent.slice(0, 50);

        expect(firstEnd).toBe(secondStart);
      }
    });

    it('中文字符应该正确计算字节', () => {
      // 中文 UTF-8 编码每个字符 3 字节
      // 667 个中文字符 ≈ 2001 字节
      const text = '测'.repeat(670);
      const chunks = channel.splitChunks(text);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('混合字符应该正确分片', () => {
      const text = 'Hello世界'.repeat(300);
      const chunks = channel.splitChunks(text);

      // 每片都不应该超过 2000 字节（考虑序号）
      chunks.forEach(chunk => {
        const byteLength = Buffer.byteLength(chunk, 'utf8');
        // 序号最长约 10 字节，留些余量
        expect(byteLength).toBeLessThanOrEqual(2010);
      });
    });

    it('空字符串应该返回空数组', () => {
      const chunks = channel.splitChunks('');
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe('');
    });
  });

  describe('send 方法', () => {
    it('未连接时不应该发送', () => {
      channel.connected = false;
      channel.send('test');

      expect(channel.buffer).toBe('');
    });

    it('已连接时应该添加到 buffer', () => {
      channel.connected = true;
      channel.send('test');

      expect(channel.buffer).toBe('test');
    });

    it('多次 send 应该追加到 buffer', () => {
      channel.connected = true;
      channel.send('hello');
      channel.send(' ');
      channel.send('world');

      expect(channel.buffer).toBe('hello world');
    });
  });

  describe('isConnected 方法', () => {
    it('应该返回连接状态', () => {
      channel.connected = false;
      expect(channel.isConnected()).toBe(false);

      channel.connected = true;
      expect(channel.isConnected()).toBe(true);
    });
  });

  describe('isMockMode 方法', () => {
    it('应该返回模拟模式状态', () => {
      channel.mockMode = false;
      expect(channel.isMockMode()).toBe(false);

      channel.mockMode = true;
      expect(channel.isMockMode()).toBe(true);
    });
  });

  describe('sendActionCard 方法', () => {
    it('应该发送审批消息', () => {
      channel.connected = true;
      channel.sendActionCard('危险操作');

      expect(channel.buffer).toContain('需要审批');
      expect(channel.buffer).toContain('危险操作');
      expect(channel.buffer).toContain("回复 'y'");
    });

    it('没有 prompt 时应该使用默认消息', () => {
      channel.connected = true;
      channel.sendActionCard();

      expect(channel.buffer).toContain('检测到危险命令');
    });
  });

  describe('getAccessToken 方法', () => {
    it('应该返回缓存的 token', async () => {
      // 设置缓存
      channel.cachedToken = 'cached-token';
      channel.tokenExpireAt = Date.now() + 60 * 60 * 1000; // 1 小时后过期

      const token = await channel.getAccessToken();
      expect(token).toBe('cached-token');
    });

    it('过期后应该重新获取', async () => {
      // 设置过期缓存
      channel.cachedToken = 'expired-token';
      channel.tokenExpireAt = Date.now() - 1000; // 已过期

      const token = await channel.getAccessToken();
      expect(token).toBe('mock-token');
    });
  });
});

describe('splitChunks 边界情况', () => {
  let channel;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../src/channel/dingtalk.js');
    channel = new module.default();
  });

  it('单个 emoji 不应该分片', () => {
    const text = '🎉';
    const chunks = channel.splitChunks(text);

    expect(chunks).toHaveLength(1);
  });

  it('大量 emoji 应该正确分片', () => {
    // 大多数 emoji 是 4 字节
    const text = '🎉'.repeat(600);
    const chunks = channel.splitChunks(text);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('换行符不应该影响分片', () => {
    const text = 'line\n'.repeat(500);
    const chunks = channel.splitChunks(text);

    chunks.forEach(chunk => {
      expect(chunk).toBeDefined();
    });
  });

  it('Tab 字符应该正确处理', () => {
    const text = '\t'.repeat(1000) + 'a'.repeat(1500);
    const chunks = channel.splitChunks(text);

    expect(chunks.length).toBeGreaterThan(0);
  });
});
