import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock 环境变量
vi.mock('../../src/config/index.js', () => ({
  getDashScopeApiKey: () => 'test-api-key',
  getDashScopeModel: () => 'qwen3.5-flash',
  get: (key, defaultValue) => defaultValue,
  require: (key) => {
    if (key === 'DASHSCOPE_API_KEY') return 'test-api-key';
    throw new Error(`Missing ${key}`);
  }
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content: '{"type": "claude_command", "command": "test", "params": {}, "confidence": 0.9}' } }]
      }
    })
  }
}));

describe('LLM Client', () => {
  it('should be importable', async () => {
    const { getLLMClient } = await import('../../src/llm/index.js');
    expect(getLLMClient).toBeDefined();
  });

  it('should have required methods', async () => {
    const { getLLMClient } = await import('../../src/llm/index.js');
    const client = getLLMClient();
    expect(client.isAvailable).toBeDefined();
    expect(client.parseIntent).toBeDefined();
    expect(client.formatOutput).toBeDefined();
    expect(client.parseSelection).toBeDefined();
  });
});

describe('Prompts', () => {
  it('should have all required prompts', async () => {
    const { Prompts } = await import('../../src/llm/index.js');
    expect(Prompts.parseIntent).toBeDefined();
    expect(Prompts.formatOutput).toBeDefined();
    expect(Prompts.parseSelection).toBeDefined();
    expect(Prompts.mapSelection).toBeDefined();
  });
});
