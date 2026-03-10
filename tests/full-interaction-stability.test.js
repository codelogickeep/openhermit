/**
 * 完整交互流程稳定性测试
 * 测试 analyzeOutput + parseReply 两个阶段
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getLLMClient } from '../src/llm/client.js';
import { InteractionPrompts } from '../src/llm/prompts/interaction.js';

// 真实日志数据 - 终端输出（有空格版本）
const realTerminalOutputWithSpaces = `
To change this later, run /theme

❯ 1. Dark mode ✔
  2. Light mode
  3. Dark mode (colorblind-friendly)
  4. Light mode (colorblind-friendly)
  5. Dark mode (ANSI colors only)
  6. Light mode (ANSI colors only)

  1 function greet() {
  2    console.log("Hello, World!");
- 3    console.log("Hello, Claude!");
  4 }
  Syntax highlighting available only in native build
`;

// 真实日志数据 - 终端输出（无空格版本，更接近真实）
const realTerminalOutputNoSpaces = `
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

// 使用无空格版本作为默认测试数据
const realTerminalOutput = realTerminalOutputNoSpaces;

describe('完整交互流程稳定性测试', () => {
  let llmClient;

  beforeAll(() => {
    llmClient = getLLMClient();
  });

  // 测试阶段1：analyzeOutput
  describe('阶段1: analyzeOutput', () => {
    it('应正确识别 selectionType=arrow 和 defaultOptionIndex=1', async () => {
      if (!llmClient.isAvailable()) {
        console.log('LLM 不可用，跳过测试');
        return;
      }

      const prompt = InteractionPrompts.analyzeOutput
        .replace('{{terminalOutput}}', realTerminalOutput);

      console.log('\n📤 阶段1 - 发送给 LLM 的 Prompt (analyzeOutput):');
      console.log('='.repeat(60));

      const response = await llmClient.chat(prompt, {
        temperature: 0.2,
        maxTokens: 500,
        timeout: 20000,
        systemPrompt: '你是一个终端交互分析助手，只返回 JSON 格式结果。'
      });

      console.log('\n📥 阶段1 - LLM 响应:');
      console.log(response);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();

      const analysis = JSON.parse(jsonMatch[0]);
      console.log('\n📊 解析结果:');
      console.log(JSON.stringify(analysis, null, 2));

      // 验证
      expect(analysis.needsInteraction).toBe(true);
      expect(analysis.type).toBe('selection');
      expect(analysis.selectionType).toBe('arrow');
      expect(analysis.defaultOptionIndex).toBe(1);  // 关键！
      expect(analysis.context.options).toHaveLength(6);
    }, 30000);

    // 多次测试稳定性
    it('连续5次测试 analyzeOutput 应稳定返回 defaultOptionIndex=1', async () => {
      if (!llmClient.isAvailable()) {
        console.log('LLM 不可用，跳过测试');
        return;
      }

      const results = [];
      for (let i = 0; i < 5; i++) {
        const prompt = InteractionPrompts.analyzeOutput
          .replace('{{terminalOutput}}', realTerminalOutput);

        const response = await llmClient.chat(prompt, {
          temperature: 0.2,
          maxTokens: 500,
          timeout: 20000,
          systemPrompt: '你是一个终端交互分析助手，只返回 JSON 格式结果。'
        });

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        const analysis = JSON.parse(jsonMatch[0]);
        results.push(analysis.defaultOptionIndex);
        console.log(`第 ${i + 1} 次: defaultOptionIndex = ${analysis.defaultOptionIndex}`);
      }

      console.log('\n📊 analyzeOutput 稳定性统计:');
      console.log('defaultOptionIndex:', results);

      const correctCount = results.filter(i => i === 1).length;
      const stability = correctCount / results.length;
      console.log(`稳定性: ${correctCount}/${results.length} = ${(stability * 100).toFixed(1)}%`);

      expect(stability).toBeGreaterThanOrEqual(0.8);
    }, 120000);
  });

  // 测试阶段2：parseReply
  describe('阶段2: parseReply', () => {
    it('用户输入 "2" 时应返回 targetOption=2', async () => {
      if (!llmClient.isAvailable()) {
        console.log('LLM 不可用，跳过测试');
        return;
      }

      // 使用正确的分析结果
      const analysis = {
        needsInteraction: true,
        type: "selection",
        selectionType: "arrow",
        defaultOptionIndex: 1,  // 正确值
        taskCompleted: false,
        context: {
          question: "请选择最适合你终端的文本样式。",
          options: [
            "Dark mode",
            "Light mode",
            "Dark mode (colorblind-friendly)",
            "Light mode (colorblind-friendly)",
            "Dark mode (ANSI colors only)",
            "Light mode (ANSI colors only)"
          ]
        }
      };

      const userReply = "2";
      const prompt = InteractionPrompts.parseReply
        .replace('{{terminalOutput}}', realTerminalOutput)
        .replace('{{previousAnalysis}}', JSON.stringify(analysis))
        .replace('{{userReply}}', userReply);

      const response = await llmClient.chat(prompt, {
        temperature: 0.2,
        maxTokens: 300,
        timeout: 20000,
        systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
      });

      console.log('\n📥 阶段2 - LLM 响应 (parseReply):');
      console.log(response);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch[0]);

      console.log('\n📊 parseReply 结果:');
      console.log(JSON.stringify(result, null, 2));

      // 验证
      expect(result.selectionType).toBe('arrow');
      expect(result.targetOption).toBe(2);
    }, 30000);
  });

  // 完整流程测试
  describe('完整流程', () => {
    it('用户选 "2" 时，最终 arrowCount 应为 1', async () => {
      if (!llmClient.isAvailable()) {
        console.log('LLM 不可用，跳过测试');
        return;
      }

      // 阶段1：分析终端输出
      const analyzePrompt = InteractionPrompts.analyzeOutput
        .replace('{{terminalOutput}}', realTerminalOutput);

      const analyzeResponse = await llmClient.chat(analyzePrompt, {
        temperature: 0.2,
        maxTokens: 500,
        timeout: 20000,
        systemPrompt: '你是一个终端交互分析助手，只返回 JSON 格式结果。'
      });

      const analyzeMatch = analyzeResponse.match(/\{[\s\S]*\}/);
      const analysis = JSON.parse(analyzeMatch[0]);
      const defaultOptionIndex = analysis.defaultOptionIndex;

      console.log(`\n阶段1 结果: defaultOptionIndex = ${defaultOptionIndex}`);

      // 阶段2：解析用户回复
      const userReply = "2";
      const parsePrompt = InteractionPrompts.parseReply
        .replace('{{terminalOutput}}', realTerminalOutput)
        .replace('{{previousAnalysis}}', JSON.stringify(analysis))
        .replace('{{userReply}}', userReply);

      const parseResponse = await llmClient.chat(parsePrompt, {
        temperature: 0.2,
        maxTokens: 300,
        timeout: 20000,
        systemPrompt: '你是一个用户意图解析助手，只返回 JSON 格式结果。'
      });

      const parseMatch = parseResponse.match(/\{[\s\S]*\}/);
      const parseResult = JSON.parse(parseMatch[0]);

      console.log(`\n阶段2 结果: targetOption = ${parseResult.targetOption}, arrowCount = ${parseResult.arrowCount}`);

      // 计算最终 arrowCount
      let arrowCount;
      if (parseResult.targetOption !== undefined) {
        arrowCount = parseResult.targetOption - defaultOptionIndex;
      } else {
        arrowCount = parseResult.arrowCount || 0;
      }

      console.log(`\n最终计算: arrowCount = ${arrowCount}`);

      // 验证
      expect(arrowCount).toBe(1);  // 用户选第2个，默认第1个，需要按1次下箭头
    }, 45000);
  });
});
