import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../.env');

// 尝试加载 .env 文件
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  console.warn('警告: 未找到 .env 文件，请复制 .env.example 为 .env 并配置');
}

/**
 * 获取配置值
 * @param {string} key - 配置键名
 * @param {any} defaultValue - 默认值
 * @returns {string|undefined}
 */
export function get(key, defaultValue = undefined) {
  return process.env[key] || defaultValue;
}

/**
 * 获取必填配置，如果缺失则抛出错误
 * @param {string} key - 配置键名
 * @returns {string}
 */
export function require(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`缺少必需的配置项: ${key}，请在 .env 文件中配置`);
  }
  return value;
}

/**
 * 获取钉钉 AppKey
 */
export function getDingTalkAppKey() {
  return require('DINGTALK_APP_KEY');
}

/**
 * 获取钉钉 AppSecret
 */
export function getDingTalkAppSecret() {
  return require('DINGTALK_APP_SECRET');
}

/**
 * 获取允许的工作目录根路径
 */
export function getAllowedRootDir() {
  return require('ALLOWED_ROOT_DIR');
}

/**
 * 获取 Anthropic API Key（可选）
 */
export function getAnthropicApiKey() {
  return get('ANTHROPIC_API_KEY');
}

/**
 * 获取 Anthropic Base URL（可选）
 */
export function getAnthropicBaseUrl() {
  return get('ANTHROPIC_BASE_URL');
}

/**
 * 获取钉钉用户 ID（可选）
 * 用于启动时主动发送消息
 */
export function getDingTalkUserId() {
  return get('DINGTALK_USER_ID');
}

/**
 * 检查环境依赖
 * @returns {object} 检查结果
 */
export function checkEnvironment() {
  const issues = [];
  const warnings = [];

  // 1. 检查 Node.js 版本
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
  if (majorVersion < 18) {
    issues.push(`Node.js 版本过低: ${nodeVersion}，需要 v18 或更高版本`);
  }

  // 2. 检查必需的环境变量
  const requiredVars = ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET', 'ALLOWED_ROOT_DIR'];
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      issues.push(`缺少环境变量: ${varName}`);
    }
  }

  // 3. 检查工作目录是否存在
  const allowedRootDir = process.env.ALLOWED_ROOT_DIR;
  if (allowedRootDir && !fs.existsSync(allowedRootDir)) {
    issues.push(`工作目录不存在: ${allowedRootDir}`);
  }

  // 4. 检查 node-pty 是否可用（通过检查二进制文件）
  const nodePtyPath = path.join(__dirname, '../../node_modules/node-pty/build/Release/pty.node');
  if (!fs.existsSync(nodePtyPath)) {
    issues.push('node-pty 二进制文件未找到，请运行 npm install');
  }

  // 5. 检查系统环境
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'linux') {
    warnings.push(`不支持的平台: ${platform}，仅支持 macOS 和 Linux`);
  }

  // 6. 检查 shell 是否存在
  const shell = process.env.SHELL || '/bin/bash';
  if (!fs.existsSync(shell)) {
    warnings.push(`Shell 不存在: ${shell}`);
  }

  // 7. 检查 DingTalk SDK（仅检查是否安装，不检查网络）
  try {
    require('dingtalk-stream-sdk-nodejs');
    // SDK 已安装，网络问题会在运行时处理
  } catch (e) {
    warnings.push('dingtalk-stream-sdk-nodejs 未安装，将使用模拟模式');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    info: {
      platform,
      nodeVersion,
      shell,
      cpuCount: os.cpus().length,
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`
    }
  };
}

/**
 * 验证所有必填配置
 */
export function validateConfig() {
  // 先检查环境
  const envCheck = checkEnvironment();
  if (!envCheck.valid) {
    console.error('环境检查失败:');
    envCheck.issues.forEach(issue => console.error(`  - ${issue}`));
    return false;
  }

  if (envCheck.warnings.length > 0) {
    console.warn('环境警告:');
    envCheck.warnings.forEach(warning => console.warn(`  - ${warning}`));
  }

  try {
    getDingTalkAppKey();
    getDingTalkAppSecret();
    getAllowedRootDir();
    return true;
  } catch (error) {
    console.error('配置验证失败:', error.message);
    return false;
  }
}

/**
 * 打印环境信息
 */
export function printEnvironmentInfo() {
  const envCheck = checkEnvironment();

  console.log('\n=== OpenHermit 环境信息 ===');
  console.log(`平台: ${envCheck.info.platform}`);
  console.log(`Node.js: ${envCheck.info.nodeVersion}`);
  console.log(`Shell: ${envCheck.info.shell}`);
  console.log(`CPU: ${envCheck.info.cpuCount} 核`);
  console.log(`内存: ${envCheck.info.totalMemory}`);

  if (envCheck.issues.length > 0) {
    console.log('\n问题:');
    envCheck.issues.forEach(issue => console.log(`  ❌ ${issue}`));
  }

  if (envCheck.warnings.length > 0) {
    console.log('\n警告:');
    envCheck.warnings.forEach(warning => console.log(`  ⚠️ ${warning}`));
  }

  if (envCheck.valid) {
    console.log('\n✅ 环境检查通过\n');
  } else {
    console.log('\n❌ 环境检查未通过\n');
  }

  return envCheck;
}

export default {
  get,
  require,
  getDingTalkAppKey,
  getDingTalkAppSecret,
  getAllowedRootDir,
  getAnthropicApiKey,
  getAnthropicBaseUrl,
  getDingTalkUserId,
  checkEnvironment,
  validateConfig,
  printEnvironmentInfo
};
