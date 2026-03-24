/**
 * openhermit uninit 命令
 * 从配置中移除 OpenHermit hooks（支持项目级别和全局）
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
 * 获取 OpenHermit hooks 目录
 * @returns {string}
 */
function getHooksDir() {
  return path.resolve(__dirname, '../hooks');
}

/**
 * 检查 hook 是否来自 OpenHermit
 * @param {object} hook - hook 配置
 * @param {string} hooksDir - hooks 目录
 * @returns {boolean}
 */
function isHermitHook(hook, hooksDir) {
  if (!hook.command) return false;
  return hook.command.startsWith(hooksDir) || hook.command.includes('openhermit');
}

/**
 * 从 hooks 数组中移除 OpenHermit 的 hooks
 * @param {Array} hooksArray - hooks 数组
 * @param {string} hooksDir - hooks 目录
 * @returns {Array} 过滤后的数组
 */
function filterHermitHooks(hooksArray, hooksDir) {
  if (!Array.isArray(hooksArray)) return hooksArray;

  return hooksArray.map(hookConfig => {
    if (!hookConfig.hooks) return hookConfig;

    const filteredHooks = hookConfig.hooks.filter(hook => {
      return !isHermitHook(hook, hooksDir);
    });

    // 如果 hooks 数组为空，过滤掉整个配置
    if (filteredHooks.length === 0) {
      return null;
    }

    return { ...hookConfig, hooks: filteredHooks };
  }).filter(Boolean);
}

/**
 * 执行 uninit 命令
 * @param {object} options - 选项
 * @param {string} options.projectPath - 项目路径（可选，不传则为全局）
 * @param {boolean} options.backup - 是否备份原配置
 */
export async function uninitHermit(options = {}) {
  const { projectPath = null, backup = true } = options;

  // 确定是项目级别还是全局
  const isProjectLevel = !!projectPath;
  const targetDir = isProjectLevel
    ? getProjectClaudeDir(projectPath)
    : getGlobalClaudeDir();
  const settingsPath = path.join(targetDir, 'settings.json');
  const hooksDir = getHooksDir();

  console.log('');
  console.log('🦀 OpenHermit Uninit');
  console.log('====================');
  console.log(`📁 配置级别: ${isProjectLevel ? '项目级别' : '全局'}`);
  console.log(`📁 配置目录: ${targetDir}`);
  if (isProjectLevel) {
    console.log(`📁 项目路径: ${projectPath}`);
  }
  console.log('');

  // 检查配置文件是否存在
  if (!fs.existsSync(settingsPath)) {
    console.log('⚠️  settings.json 不存在，无需清理');
    return { success: true, nothingToClean: true };
  }

  // 读取现有配置
  let settings;
  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(content);
  } catch (error) {
    console.error(`❌ 读取配置失败: ${error.message}`);
    return { success: false, error: error.message };
  }

  // 检查是否有 hooks 配置
  if (!settings.hooks) {
    console.log('⚠️  配置中没有 hooks，无需清理');
    return { success: true, nothingToClean: true };
  }

  // 备份原配置
  if (backup) {
    const backupPath = `${settingsPath}.hermit-backup-${Date.now()}`;
    fs.copyFileSync(settingsPath, backupPath);
    console.log(`💾 已备份原配置到: ${backupPath}`);
  }

  // 移除 OpenHermit hooks
  let removedCount = 0;

  const hookTypes = ['PreToolUse', 'Notification', 'Stop'];
  for (const hookType of hookTypes) {
    if (settings.hooks[hookType]) {
      const originalLength = settings.hooks[hookType].length;
      settings.hooks[hookType] = filterHermitHooks(settings.hooks[hookType], hooksDir);
      removedCount += originalLength - settings.hooks[hookType].length;

      // 如果数组为空，删除该 hook 类型
      if (settings.hooks[hookType].length === 0) {
        delete settings.hooks[hookType];
      }
    }
  }

  // 如果 hooks 对象为空，删除整个 hooks 字段
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
    console.log('🧹 已清空所有 hooks 配置');
  }

  // 写回配置
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log(`✅ 已移除 ${removedCount} 个 OpenHermit hooks`);
  console.log('✅ Uninit 完成！');

  console.log('');
  console.log('📖 提示:');
  console.log('   • Claude Code 的 hooks 配置已恢复');
  console.log('   • 如需重新启用，运行: openhermit init');
  console.log('');

  return { success: true, removedCount };
}

/**
 * 获取 OpenHermit hooks 注入状态
 * @param {string} projectPath - 项目路径（可选）
 * @returns {object}
 */
export function getUninitStatus(projectPath = null) {
  const targetDir = projectPath
    ? getProjectClaudeDir(projectPath)
    : getGlobalClaudeDir();
  const settingsPath = path.join(targetDir, 'settings.json');
  const hooksDir = getHooksDir();

  if (!fs.existsSync(settingsPath)) {
    return { hasHermitHooks: false };
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    if (!settings.hooks) {
      return { hasHermitHooks: false };
    }

    // 检查是否有 OpenHermit hooks
    const hookTypes = ['PreToolUse', 'Notification', 'Stop'];
    let hermitHookCount = 0;

    for (const hookType of hookTypes) {
      if (settings.hooks[hookType]) {
        for (const hookConfig of settings.hooks[hookType]) {
          if (hookConfig.hooks) {
            for (const hook of hookConfig.hooks) {
              if (isHermitHook(hook, hooksDir)) {
                hermitHookCount++;
              }
            }
          }
        }
      }
    }

    return {
      hasHermitHooks: hermitHookCount > 0,
      hermitHookCount,
      settingsPath,
      isProjectLevel: !!projectPath
    };
  } catch (error) {
    return { hasHermitHooks: false, error: error.message };
  }
}

export default uninitHermit;
