/**
 * LLM Prompts 统一导出
 * 按功能域分类管理所有 prompt 模板
 *
 * 目录结构：
 * - intent.js: 意图解析相关（parseIntent, contextProcess）
 * - interaction.js: 交互检测相关（analyzeOutput, parseReply, parseSelection, mapSelection）
 * - format.js: 格式化相关（formatOutput, summarizeStatus）
 */

import { IntentPrompts } from './intent.js';
import { InteractionPrompts } from './interaction.js';
import { FormatPrompts } from './format.js';

/**
 * 统一 Prompts 对象（兼容旧代码）
 * 保持与原 prompts.js 相同的 API
 */
export const Prompts = {
  // 意图解析
  parseIntent: IntentPrompts.parseIntent,
  contextProcess: IntentPrompts.contextProcess,

  // 交互检测
  analyzeOutput: InteractionPrompts.analyzeOutput,
  parseReply: InteractionPrompts.parseReply,
  parseSelection: InteractionPrompts.parseSelection,
  mapSelection: InteractionPrompts.mapSelection,

  // 格式化
  formatOutput: FormatPrompts.formatOutput,
  summarizeStatus: FormatPrompts.summarizeStatus
};

// 导出各功能域（推荐使用）
export { IntentPrompts } from './intent.js';
export { InteractionPrompts } from './interaction.js';
export { FormatPrompts } from './format.js';

// 默认导出
export default Prompts;
