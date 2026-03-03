/**
 * LLM 模块入口
 * 提供阿里云百炼 API 客户端
 */

import LLMClient, { getLLMClient } from './client.js';
import { Prompts, IntentPrompts, InteractionPrompts, FormatPrompts } from './prompts/index.js';
import InteractionContext, { getInteractionContext } from './interactionContext.js';
import LLMInteractionAnalyzer, { getInteractionAnalyzer } from './interactionAnalyzer.js';

export {
  LLMClient,
  getLLMClient,
  Prompts,
  IntentPrompts,
  InteractionPrompts,
  FormatPrompts,
  InteractionContext,
  getInteractionContext,
  LLMInteractionAnalyzer,
  getInteractionAnalyzer
};

export default {
  LLMClient,
  getLLMClient,
  Prompts,
  IntentPrompts,
  InteractionPrompts,
  FormatPrompts,
  InteractionContext,
  getInteractionContext,
  LLMInteractionAnalyzer,
  getInteractionAnalyzer
};
