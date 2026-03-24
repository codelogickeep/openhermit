/**
 * openhermit init 命令
 * 将 OpenHermit hooks 配置注入到用户全局 ~/.claude/settings.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 深度合并对象
 * @param {object} target - 目标对象
 * @param {object} source - 源对象
 * @returns {object} 合并后的对象
 */
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (Array.isArray(source[key])) {
      // 数组：合并去重
      const targetArray = Array.isArray(result[key]) ? result[key] : [];
      result[key] = [...targetArray, ...source[key]];
      // 去重（基于 JSON 字符串）
      const seen = new Set();
      result[key] = result[key].filter(item => {
        const key = JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * 获取用户 Claude 配置目录
 * @returns {string}
 */
function getUserClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

/**
 * 获取 OpenHermit hooks 目录（npm 包内的绝对路径）
 * @returns {string}
 */
function getHooksDir() {
  return path.resolve(__dirname, '../hooks');
}

/**
 * 生成 OpenHermit hooks 配置
 * @param {string} hooksDir - hooks 脚本目录
 * @returns {object}
 */
function generateHermitHooksConfig(hooksDir) {
  return {
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
}

/**
 * 检查是否已注入 OpenHermit hooks
 * @param {object} settings - 用户配置
 * @param {string} hooksDir - hooks 目录
 * @returns {boolean}
 */
function isHermitHooksInjected(settings, hooksDir) {
  if (!settings.hooks) return false;

  // 检查 PreToolUse 中是否有我们的 hook
  const preToolHooks = settings.hooks.PreToolUse || [];
  for (const hookConfig of preToolHooks) {
    if (hookConfig.hooks) {
      for (const hook of hookConfig.hooks) {
        if (hook.command && hook.command.includes('openhermit')) {
          return true;
        }
        if (hook.command && hook.command.startsWith(hooksDir)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 执行 init 命令
 * @param {object} options - 选项
 * @param {boolean} options.force - 强制重新注入
 * @param {boolean} options.backup - 是否备份原配置
 */
export async function initHermit(options = {}) {
  const { force = false, backup = true } = options;

  const userClaudeDir = getUserClaudeDir();
  const settingsPath = path.join(userClaudeDir, 'settings.json');
  const hooksDir = getHooksDir();
  const hermitHooks = generateHermitHooksConfig(hooksDir);

  console.log('');
  console.log('🦀 OpenHermit Init');
  console.log('==================');
  console.log(`📁 Claude 配置目录: ${userClaudeDir}`);
  console.log(`📁 Hooks 脚本目录: ${hooksDir}`);
  console.log('');

  // 确保 .claude 目录存在
  if (!fs.existsSync(userClaudeDir)) {
    fs.mkdirSync(userClaudeDir, { recursive: true });
    console.log('✅ 已创建 .claude 目录');
  }

  // 读取现有配置
  let existingSettings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      existingSettings = JSON.parse(content);
      console.log('📖 已读取现有配置');

      // 检查是否已注入
      if (!force && isHermitHooksInjected(existingSettings, hooksDir)) {
        console.log('');
        console.log('⚠️  OpenHermit hooks 已经注入过了');
        console.log('   使用 --force 参数强制重新注入');
        console.log('');
        return { success: true, alreadyInjected: true };
      }
    } catch (error) {
      console.warn(`⚠️  读取配置失败: ${error.message}`);
      console.log('   将创建新配置');
    }
  }

  // 备份原配置
  if (backup && fs.existsSync(settingsPath)) {
    const backupPath = `${settingsPath}.hermit-backup-${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`💾 已备份原配置到: ${backupPath}`);
  }

  // 合并配置
  const mergedSettings = deepMerge(existingSettings, hermitHooks);

  // 写入配置
  fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));
  console.log('✅ 已写入配置到 settings.json');

  // 显示注入的 hooks
  console.log('');
  console.log('📋 已注入的 Hooks:');
  console.log('   • PreToolUse  - 工具执行前触发');
  console.log('   • Notification - 状态通知时触发');
  console.log('   • Stop        - 任务完成时触发');
  console.log('');

  console.log('✅ Init 完成！');
  console.log('');
  console.log('📖 使用方法:');
  console.log('   1. 正常启动 Claude Code: claude');
  console.log('   2. 启动 OpenHermit 监控: openhermit monitor');
  console.log('   3. 取消注入: openhermit uninit');
  console.log('');

  return { success: true, alreadyInjected: false };
}

/**
 * 获取 Init 命令状态
 * @returns {object}
 */
export function getInitStatus() {
  const userClaudeDir = getUserClaudeDir();
  const settingsPath = path.join(userClaudeDir, 'settings.json');
  const hooksDir = getHooksDir();

  if (!fs.existsSync(settingsPath)) {
    return { initialized: false, reason: 'settings.json 不存在' };
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    return {
      initialized: isHermitHooksInjected(settings, hooksDir),
      settingsPath,
      hooksDir
    };
  } catch (error) {
    return { initialized: false, reason: error.message };
  }
}

export default initHermit;
