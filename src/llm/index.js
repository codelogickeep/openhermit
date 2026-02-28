/**
 * LLM 模块入口
 * 提供阿里云百炼 API 客户端
 */

import LLMClient, { getLLMClient } from './client.js';
import { Prompts } from './prompts.js';

export { LLMClient, getLLMClient, Prompts };

export default {
  LLMClient,
  getLLMClient,
  Prompts
};
