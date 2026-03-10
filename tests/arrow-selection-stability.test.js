/**
 * 方向键选择模式稳定性测试
 * 使用真实日志数据测试 LLM 解析是否稳定输出正确结果
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getLLMClient } from '../src/llm/client.js';
import { InteractionPrompts } from '../src/llm/prompts/interaction.js';

// 真实日志数据（无空格版本，更接近真实 PTY 输出）
const realTerminalOutput = `
To change this later, run /theme

❯1.Darkmode✔
  2.Lightmode
  3.Darkmode(colorblind-friendly)
  4.Lightmode(colorblind-friendly)
  5.Darkmode(ANSIcolorsonly)
  6.Lightmode(ANSIcolorsonly)

  1 function greet() {
  2    console.log("Hello, World!");
- 3    console.log("Hello, Claude!");
  4 }
  Syntax highlighting available only in native build
`;

// analyzeOutput 返回的真实结果
const realAnalysis = {
  needsInteraction: true,
  type: "selection",
  selectionType: "arrow",
  defaultOptionIndex: 1,  // ❯ 在第1行，数字是 1
  taskCompleted: false,
  context: {
    question: "请选择最适合你终端的文本样式。",
    options: [
      "Darkmode",
      "Lightmode",
      "Darkmode(colorblind-friendly)",
      "Lightmode(colorblind-friendly)",
      "Darkmode(ANSIcolorsonly)",
      "Lightmode(ANSIcolorsonly)"
    ],
    additionalInfo: "当前高亮选中第1项 'Darkmode'，并标记为 ✔"
  }
};

describe('方向键选择模式稳定性测试', () => {
  let llmClient;

  beforeAll(() => {
    llmClient = getLLMClient();
  });

  // 测试1：用户选择第2个选项（Light mode）
  it('用户输入 "2" 时应返回 targetOption=2，计算 arrowCount=1', async () => {
    if (!llmClient.isAvailable()) {
      console.log('LLM 不可用，跳过测试');
      return;
    }

    const userReply = "2";
    const prompt = InteractionPrompts.parseReply
      .replace('{{terminalOutput}}', realTerminalOutput)
      .replace('{{userReply}}', userReply);

    console.log('\n📤 发送给 LLM 的 Prompt:');
    console.log('='.repeat(60));
    console.log(prompt);
    console.log('='.repeat(60));

    const response = await llmClient.chat(prompt, {
      temperature: 0.2,
      maxTokens: 300,
      timeout: 20000,
      systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
    });

    console.log('\n📥 LLM 原始响应:');
    console.log('='.repeat(60));
    console.log(response);
    console.log('='.repeat(60));

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch[0]);
    console.log('\n📊 解析后的 JSON:');
    console.log(JSON.stringify(result, null, 2));

    // 验证关键字段
    expect(result.selectionType).toBe('arrow');

    // 关键：验证 targetOption 或 arrowCount
    if (result.targetOption !== undefined) {
      console.log(`\n✅ LLM 返回了 targetOption: ${result.targetOption}`);
      expect(result.targetOption).toBe(2);
    } else if (result.arrowCount !== undefined) {
      console.log(`\n⚠️ LLM 返回了 arrowCount: ${result.arrowCount}`);
      // 如果默认是第1个，选第2个应该 arrowCount=1
      expect(result.arrowCount).toBe(1);
    } else {
      console.log('\n❌ LLM 没有返回 targetOption 或 arrowCount');
      expect.fail('LLM 应该返回 targetOption 或 arrowCount');
    }
  }, 30000);

  // 测试2：用户选择默认选项（第1个）
  it('用户输入 "1" 时应返回 targetOption=1，计算 arrowCount=0', async () => {
    if (!llmClient.isAvailable()) {
      console.log('LLM 不可用，跳过测试');
      return;
    }

    const userReply = "1";
    const prompt = InteractionPrompts.parseReply
      .replace('{{terminalOutput}}', realTerminalOutput)
      .replace('{{userReply}}', userReply);

    const response = await llmClient.chat(prompt, {
      temperature: 0.2,
      maxTokens: 300,
      timeout: 20000,
      systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
    });

    console.log('\n📥 LLM 响应 (选择第1个):', response);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch[0]);
    expect(result.selectionType).toBe('arrow');

    if (result.targetOption !== undefined) {
      expect(result.targetOption).toBe(1);
    } else if (result.arrowCount !== undefined) {
      expect(result.arrowCount).toBe(0);
    }
  }, 30000);

  // 测试3：用户选择第3个选项
  it('用户输入 "3" 时应返回 targetOption=3，计算 arrowCount=2', async () => {
    if (!llmClient.isAvailable()) {
      console.log('LLM 不可用，跳过测试');
      return;
    }

    const userReply = "3";
    const prompt = InteractionPrompts.parseReply
      .replace('{{terminalOutput}}', realTerminalOutput)
      .replace('{{userReply}}', userReply);

    const response = await llmClient.chat(prompt, {
      temperature: 0.2,
      maxTokens: 300,
      timeout: 20000,
      systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
    });

    console.log('\n📥 LLM 响应 (选择第3个):', response);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();

    const result = JSON.parse(jsonMatch[0]);
    expect(result.selectionType).toBe('arrow');

    if (result.targetOption !== undefined) {
      expect(result.targetOption).toBe(3);
    } else if (result.arrowCount !== undefined) {
      expect(result.arrowCount).toBe(2);
    }
  }, 30000);

  // 测试4：多次运行验证稳定性
  it('连续5次测试应稳定返回正确结果', async () => {
    if (!llmClient.isAvailable()) {
      console.log('LLM 不可用，跳过测试');
      return;
    }

    const results = [];
    const userReply = "2";

    for (let i = 0; i < 5; i++) {
      const prompt = InteractionPrompts.parseReply
        .replace('{{terminalOutput}}', realTerminalOutput)
        .replace('{{previousAnalysis}}', JSON.stringify(realAnalysis))
        .replace('{{userReply}}', userReply);

      const response = await llmClient.chat(prompt, {
        temperature: 0.2,
        maxTokens: 300,
        timeout: 20000,
        systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch[0]);
      results.push(result);

      console.log(`\n第 ${i + 1} 次结果:`, JSON.stringify(result));
    }

    // 统计结果
    const targetOptions = results.map(r => r.targetOption);
    const arrowCounts = results.map(r => r.arrowCount);

    console.log('\n📊 统计结果:');
    console.log('targetOptions:', targetOptions);
    console.log('arrowCounts:', arrowCounts);

    // 验证稳定性：至少 80% 的结果正确
    let correctCount = 0;
    for (const result of results) {
      if (result.targetOption === 2 || result.arrowCount === 1) {
        correctCount++;
      }
    }

    const stability = correctCount / results.length;
    console.log(`\n稳定性: ${correctCount}/${results.length} = ${(stability * 100).toFixed(1)}%`);

    expect(stability).toBeGreaterThanOrEqual(0.8);
  }, 120000);
});
