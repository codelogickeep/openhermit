import { getAnthropicApiKey, getAnthropicBaseUrl } from '../config/index.js';
import fs from 'fs';

/**
 * 构建传递给 PTY 进程的环境变量
 * @param {object} options - 选项
 * @param {string} [options.cwd] - 工作目录
 * @returns {object} 环境变量对象
 */
export function buildEnv(options = {}) {
  // 继承宿主机的环境变量
  const env = { ...process.env };

  // 注入 Anthropic API 配置（如果提供）
  const apiKey = getAnthropicApiKey();
  const baseUrl = getAnthropicBaseUrl();

  if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }

  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
  }

  // 设置工作目录
  if (options.cwd) {
    env.PWD = options.cwd;
    env.TERM_PROGRAM = 'openhermit';
  }

  return env;
}

/**
 * 获取默认的 shell
 * @returns {string} shell 路径
 */
export function getDefaultShell() {
  // 优先使用 claude
  const claudePath = '/usr/local/bin/claude';

  if (fs.existsSync(claudePath)) {
    return claudePath;
  }

  // 降级使用 bash
  return process.env.SHELL || '/bin/bash';
}

export default {
  buildEnv,
  getDefaultShell
};
