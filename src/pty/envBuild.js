import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { getAnthropicApiKey, getAnthropicBaseUrl } from '../config/index.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 默认 IPC 端口
const DEFAULT_IPC_PORT = 31337;

// 影子配置目录（临时）
let shadowConfigDir = null;

/**
 * 生成影子配置目录
 * @param {number} ipcPort - IPC 端口
 * @returns {string} 配置目录路径
 */
export function generateShadowConfig(ipcPort = DEFAULT_IPC_PORT) {
  // 确保 hooks 目录路径是绝对的（hooks 始终在 npm 包目录中）
  const hooksDir = path.resolve(__dirname, '../hooks');

  // 判断是源码运行还是 npm 安装运行
  // 源码运行：存在 src 目录和 package.json 在上级目录，且 package.json 中没有 bin 字段
  let isSourceRun = false;
  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      // 如果没有 bin 字段，说明是源码运行（开发模式）
      isSourceRun = !packageJson.bin;
    }
  } catch {
    isSourceRun = true;
  }

  if (isSourceRun) {
    // 源码运行：在项目目录下创建 .shadow-config
    shadowConfigDir = path.join(__dirname, '../../.shadow-config');
  } else {
    // npm 安装运行：在用户 home 目录下创建 .openhermit
    const userHome = os.homedir();
    shadowConfigDir = path.join(userHome, '.openhermit');
  }

  // 生成 settings.json
  const settings = {
    hooks: {
      PreToolUse: [{
        matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit',
        hooks: [{ type: 'command', command: `${hooksDir}/pre-tool.sh` }]
      }],
      Notification: [{
        hooks: [{ type: 'command', command: `${hooksDir}/notification.sh` }]
      }],
      Stop: [{
        hooks: [{ type: 'command', command: `${hooksDir}/stop.sh` }]
      }]
    }
  };

  // 确保目录存在
  if (!fs.existsSync(shadowConfigDir)) {
    fs.mkdirSync(shadowConfigDir, { recursive: true });
  }

  // 写入 settings.json
  const settingsPath = path.join(shadowConfigDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  logger.info({ configDir: shadowConfigDir, ipcPort, isSourceRun }, '生成影子配置');

  return shadowConfigDir;
}

/**
 * 清理影子配置
 */
export function cleanupShadowConfig() {
  if (shadowConfigDir && fs.existsSync(shadowConfigDir)) {
    try {
      fs.rmSync(shadowConfigDir, { recursive: true });
      logger.debug({ dir: shadowConfigDir }, '清理影子配置');
    } catch (error) {
      logger.warn({ error: error.message }, '清理影子配置失败');
    }
    shadowConfigDir = null;
  }
}

/**
 * 获取 IPC 端口
 * @returns {number}
 */
export function getIPCPort() {
  return parseInt(process.env.HERMIT_IPC_PORT || DEFAULT_IPC_PORT, 10);
}

/**
 * 构建传递给 PTY 进程的环境变量
 * @param {object} options - 选项
 * @param {string} [options.cwd] - 工作目录
 * @param {number} [options.ipcPort] - IPC 端口
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

  // 注入影子配置（如果提供了 ipcPort 或已生成配置）
  const ipcPort = options.ipcPort || getIPCPort();

  if (options.ipcPort || shadowConfigDir) {
    // 确保配置已生成
    if (!shadowConfigDir) {
      generateShadowConfig(ipcPort);
    }

    // 注入 Claude Code 配置目录
    env.CLAUDE_CONFIG_DIR = shadowConfigDir;

    // 注入 IPC 端口（供 Hook 脚本使用）
    env.HERMIT_IPC_PORT = String(ipcPort);

    logger.debug({
      claudeConfigDir: env.CLAUDE_CONFIG_DIR,
      hermitIpcPort: env.HERMIT_IPC_PORT
    }, '注入影子配置环境变量');
  }

  return env;
}

/**
 * 获取默认的 shell
 * @returns {string} shell 路径
 */
export function getDefaultShell() {
  // 使用系统默认 shell
  return process.env.SHELL || '/bin/bash';
}

export default {
  buildEnv,
  getDefaultShell
};
