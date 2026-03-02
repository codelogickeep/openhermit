/**
 * LLM 模块入口
 * 提供阿里云百炼 API 客户端
 */

import LLMClient, { getLLMClient } from './client.js';
import { Prompts } from './prompts.js';
import InteractionContext, { getInteractionContext } from './interactionContext.js';
import LLMInteractionAnalyzer, { getInteractionAnalyzer } from './interactionAnalyzer.js';

export {
  LLMClient,
  getLLMClient,
  Prompts,
  InteractionContext,
  getInteractionContext,
  LLMInteractionAnalyzer,
  getInteractionAnalyzer
};

export default {
  LLMClient,
  getLLMClient,
  Prompts,
  InteractionContext,
  getInteractionContext,
  LLMInteractionAnalyzer,
  getInteractionAnalyzer
};
