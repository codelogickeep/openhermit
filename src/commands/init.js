/**
 * openhermit init 命令
 * 将 OpenHermit hooks 配置注入到项目级别或全局配置
 *
 * 用法:
 *   openhermit init                    # 全局注入 (~/.claude/settings.json)
 *   openhermit init /path/to/project   # 项目级别注入
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
 * 获取用户全局 Claude 配置目录
 * @returns {string}
 */
function getGlobalClaudeDir() {
  return path.join(os.homedir(), '.claude');
}

/**
 * 获取项目级别 Claude 配置目录
 * @param {string} projectPath - 项目路径
 * @returns {string}
 */
function getProjectClaudeDir(projectPath) {
  return path.join(projectPath, '.claude');
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
 * @param {string} options.projectPath - 项目路径（可选，不传则为全局）
 * @param {boolean} options.force - 强制重新注入
 * @param {boolean} options.backup - 是否备份原配置
 */
export async function initHermit(options = {}) {
  const { projectPath = null, force = false, backup = true } = options;

  // 确定是项目级别还是全局
  const isProjectLevel = !!projectPath;
  const targetDir = isProjectLevel
    ? getProjectClaudeDir(projectPath)
    : getGlobalClaudeDir();
  const settingsPath = path.join(targetDir, 'settings.json');
  const hooksDir = getHooksDir();
  const hermitHooks = generateHermitHooksConfig(hooksDir);

  console.log('');
  console.log('🦀 OpenHermit Init');
  console.log('==================');
  console.log(`📁 配置级别: ${isProjectLevel ? '项目级别' : '全局'}`);
  console.log(`📁 配置目录: ${targetDir}`);
  console.log(`📁 Hooks 目录: ${hooksDir}`);
  if (isProjectLevel) {
    console.log(`📁 项目路径: ${projectPath}`);
  }
  console.log('');

  // 确保配置目录存在
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`✅ 已创建配置目录: ${targetDir}`);
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
  console.log(`✅ 已写入配置到: ${settingsPath}`);

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
  if (isProjectLevel) {
    console.log(`   1. 进入项目: cd ${projectPath}`);
    console.log('   2. 启动 Claude Code: claude');
    console.log('   3. 在另一个终端启动监控: openhermit');
  } else {
    console.log('   1. 在任意终端启动 Claude Code: claude');
    console.log('   2. 启动 OpenHermit 监控: openhermit');
  }
  console.log('   4. 取消注入: openhermit uninit');
  console.log('');

  return { success: true, alreadyInjected: false, settingsPath };
}

/**
 * 获取 Init 命令状态
 * @param {string} projectPath - 项目路径（可选）
 * @returns {object}
 */
export function getInitStatus(projectPath = null) {
  const targetDir = projectPath
    ? getProjectClaudeDir(projectPath)
    : getGlobalClaudeDir();
  const settingsPath = path.join(targetDir, 'settings.json');
  const hooksDir = getHooksDir();

  if (!fs.existsSync(settingsPath)) {
    return { initialized: false, reason: 'settings.json 不存在', settingsPath };
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    return {
      initialized: isHermitHooksInjected(settings, hooksDir),
      settingsPath,
      hooksDir,
      isProjectLevel: !!projectPath
    };
  } catch (error) {
    return { initialized: false, reason: error.message, settingsPath };
  }
}

export default initHermit;
