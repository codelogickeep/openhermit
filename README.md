# 🦀 OpenHermit (开源寄居蟹)

> A Lightweight Hook Bridge for Claude Code & Local AI Agents.
    OpenHermit 不生产指令，只是跨越屏幕的指令搬运工。
> 隐于后台，行于指尖。把最强的大脑搬进你的口袋，让你随时随地无感接管AI Coding 工作站。




[![npm version](https://img.shields.io/npm/v/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
[![npm downloads](https://img.shields.io/npm/dm/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)

## 💡 什么是 OpenHermit？

随着 Claude Code 等原生 CLI Agent 的爆发，开发者可以在本地拥有极强的代码上下文和执行权限。但对于配置了第三方模型服务或无法使用官方云端联动的开发者来说，离开电脑桌，Agent 就断了线。

**OpenHermit（开源寄居蟹）** 是一个基于 Node.js 的轻量级桥接服务。它利用 Claude Code 原生 Hooks 机制实现**双向通信**，让你在手机上通过钉钉与本地 Claude Code 实时交互。

**v2.0 双向通信**：钉钉 ← → OpenHermit ← → Claude Code，随时随地发送指令、接收通知。

## ✨ 核心特性

* 🔄 **双向通信**：在钉钉发送指令 → Claude Code 执行，真正实现远程控制
* 🚀 **纯内网穿透**：基于钉钉 Stream 模式（WebSocket），本地机器无需暴露任何端口
* 🐚 **非侵入式设计**：不修改 Claude Code 核心，仅通过 Hook 机制实现
* 🛡️ **安全可靠**：命令超时处理、错误降级、敏感操作保护
* 📱 **移动端优化**：终端输出自动格式化，适配手机屏幕阅读
* 🤖 **智能交互模式**：自然语言直接启动 Claude Code，无需手动输入命令

## 🏗️ 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Claude Code 进程                         │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    notification.sh (Hook)                    │ │
│  │   1. 发送 IPC 事件 ─────────────────────────────────────────┐ │ │
│  │   2. 检测 idle 状态 ──────────────────────────────────────┐ │ │ │
│  │   3. 轮询命令文件 ───────────────────────────────────────┐ │ │ │ │
│  │   4. 输出到 stdout ─────────────────────────────────────┐ │ │ │ │ │
│  └────────────────────────────────────────────────────────│─│─│─│─│─┘
│                                                           │ │ │ │ │ │
│  ←────────────────────────────────────────────────────────│─│─│─│─┘
│       读取 stdout 作为输入                                  │ │ │ │ │
└───────────────────────────────────────────────────────────│─│─│─│─┘
                                                            │ │ │ │ │
                                                            ▼ │ │ │ │
┌───────────────────────────────────────────────────────────────┐ │ │ │
│                    OpenHermit 进程                             │ │ │ │
│  ┌─────────────┐    ┌─────────────┐    ┌───────────────────┐ │ │ │ │
│  │ IPC Server  │    │  钉钉通道   │    │  命令管理器        │ │ │ │ │
│  │  (31337)    │    │             │    │                   │ │ │ │ │
│  └──────┬──────┘    └──────┬──────┘    └─────────┬─────────┘ │ │ │ │
│         │                  │                     │           │ │ │ │
│         │ 接收 Hook 事件    │ 接收用户消息        │           │ │ │ │
│         │                  │                     │           │ │ │ │
│         │                  └─────────────────────│───────────│─│─│─┘
│         │                                        │ 写入命令   │ │ │
│         │                                        ▼           │ │ │
│         │                          .claude/.openhermit/       │ │ │
│         │                               commands/            │ │ │
│         │                                 └── {ts}.txt       │ │ │
│         │                                        ▲           │ │ │
│         │                                        │ 读取      │ │ │
│         └────────────────────────────────────────│───────────│─│─┘
│                                                  │           │ │
└──────────────────────────────────────────────────│───────────│─│─┘
                                                   │           │ │
                                                   ▼           │ │
┌───────────────────────────────────────────────────────────────┐ │ │
│                     钉钉 App                                   │ │ │
│   用户: "review一下当前项目"                                    │ │ │
└───────────────────────────────────────────────────────────────┘ │ │
                                                                  │ │
   轮询流程 (在 Claude Code 进程中执行):                           │ │
   ┌───────────────────────────────────────────────────────────────┘ │
   │  while (未超时) {                                                │
   │    if (命令文件存在) {                                           │
   │      读取内容 → stdout → Claude Code 执行                       │
   │      删除文件                                                    │
   │      break                                                       │
   │    }                                                             │
   │    sleep(1秒)                                                    │
   │  }                                                               │
   └──────────────────────────────────────────────────────────────────┘
```

## 🎯 使用场景

* **下班通勤**：地铁上用手机让本地 Agent 查看代码、跑测试
* **远程运维**：周末不在电脑旁，通过手机诊断系统问题
* **随时随地**：任何有网络的地方，都能访问你的本地开发环境
* **实时交互**：收到任务完成通知后，立即发送下一条指令

## 🛠️ 快速开始

### 前置要求

* Node.js v20+
* macOS 或 Linux
* 钉钉企业内部应用（[钉钉开放平台](https://open-dev.dingtalk.com/) 获取 AppKey 和 AppSecret）

### 安装

```bash
# 全局安装
npm install -g @codelogickeep/open-hermit

# 创建配置目录
mkdir -p ~/.openhermit
cd ~/.openhermit

# 复制配置模板
curl -o .env https://raw.githubusercontent.com/codelogickeep/openhermit/main/.env.example

# 编辑配置
vim .env
```

### 配置

创建 `.env` 文件：

```bash
# ===== 必填配置 =====
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret

# ===== 智能交互模式（推荐）=====
DASHSCOPE_API_KEY=sk-xxx                    # 阿里云百炼 API Key
DASHSCOPE_MODEL=qwen-plus                   # 模型（可选）

# ===== 其他可选配置 =====
# DINGTALK_USER_ID=your_staff_id            # 启动时主动推送消息
# ANTHROPIC_API_KEY=sk-ant-xxx              # API 代理
# ANTHROPIC_BASE_URL=https://your-proxy.com/v1
```

**获取百炼 API Key**：访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)

## 🚀 快速使用

OpenHermit 采用**纯监控模式**，独立运行 Claude Code，不干扰正常工作流程。

### 使用步骤

```bash
# 1. 一次性初始化（注入 hooks 到 ~/.claude/）
openhermit init

# 2. 在任意终端正常启动 Claude Code
cd ~/projects/my-app
claude

# 3. 启动监控服务（在另一个终端）
openhermit
```

### CLI 命令

| 命令 | 说明 |
|------|------|
| `openhermit` | 启动监控服务（接收 Hook 事件并推送钉钉） |
| `openhermit init [项目路径]` | 初始化 hooks 配置（无参数为全局初始化） |
| `openhermit init --force` | 强制重新初始化（覆盖现有配置） |
| `openhermit uninit` | 移除 hooks 配置 |
| `openhermit -v, --version` | 显示版本号 |
| `openhermit -h, --help` | 显示帮助信息 |

**init 命令说明：**
- `openhermit init` - 全局初始化，注入 hooks 到 `~/.claude/settings.json`（推荐）
- `openhermit init ~/projects/myapp` - 为指定项目初始化

**监控模式优势**：
- 不干扰正常工作流程
- 随时可以开关监控
- 支持多个 Claude Code 会话
- OpenHermit 崩溃不影响 Claude Code
- 无需 node-pty 等重量级依赖

### 启动成功

启动成功后显示：

```
🦀 OpenHermit 监控服务
====================

✅ 监控服务已启动

📋 等待 Claude Code Hook 事件...
   在任意终端运行 claude 即可
```

## 📱 双向通信使用

### 通信流程

```
1. Claude Code 执行任务完成 → 进入 idle 状态
2. OpenHermit 推送 "等待输入" 通知到钉钉
3. 用户在钉钉发送指令
4. OpenHermit 写入命令文件
5. Hook 轮询检测到命令文件
6. 命令内容输出到 stdout → Claude Code 执行
7. 执行完成后再次进入 idle，等待下一条指令
```

### 消息规范

| 通知类型 | 说明 | 示例 |
|----------|------|------|
| ✅ 任务完成 | 任务执行完毕 | `**项目**: openhermit` + `**耗时**: 5 分钟` |
| ⏳ 等待输入 | Claude 正在等待指令 | `Claude Code 正在等待您的指令...` |
| ⏰ 等待超时 | 用户未及时响应 | `超时: 10 分钟，请直接在终端输入` |
| 📝 已收到指令 | 命令已传递 | `正在传递给 Claude Code...` |

### 使用示例

```
钉钉收到的通知：
┌─────────────────────────────────────┐
│ ## ⏳ 等待输入                       │
│                                     │
│ **项目**: `openhermit`              │
│                                     │
│ Claude Code 正在等待您的指令...      │
└─────────────────────────────────────┘

用户回复：review一下当前项目

系统确认：
┌─────────────────────────────────────┐
│ ## 📝 已收到指令                     │
│                                     │
│ **项目**: `openhermit`              │
│ **指令**: review一下当前项目         │
│                                     │
│ 正在传递给 Claude Code...            │
└─────────────────────────────────────┘

任务完成后再次等待：
┌─────────────────────────────────────┐
│ ## ✅ 任务完成                       │
│                                     │
│ **项目**: `openhermit`              │
│ **任务**: 代码审查                   │
│ **耗时**: 3 分钟                     │
└─────────────────────────────────────┘
```

### 超时处理

如果用户 10 分钟内未响应：
- Hook 超时退出，Claude Code 保持 idle 状态
- 用户可直接在终端输入，或等待下次通知

### 命令文件结构

```
{project}/
  └── .claude/
       └── .openhermit/
            ├── commands/
            │    └── 1742845678123.txt    # 命令文件（时间戳命名）
            └── command-meta.json         # 命令元数据
```

## 🔧 高级功能

### 多项目支持（Phase 2）

当有多个 Claude Code 会话同时运行时：

```
钉钉消息格式：
@项目名 命令内容

示例：
@openhermit review一下代码
@openhermit-docs 更新文档
```

**项目选择器消息：**
```markdown
## 📂 可用项目

检测到多个空闲项目，请指定目标：

| # | 项目 | 状态 |
|---|------|------|
| 1 | `openhermit` | 🟢 空闲 |
| 2 | `openhermit-docs` | 🟢 空闲 |

**使用方式：**
- `@项目名 你的命令`
- 或回复数字选择默认项目
```

## 🔒 安全机制

* **命令文件隔离**：命令文件存储在项目 `.claude/.openhermit/` 目录下，不跨项目
* **超时保护**：命令等待超时（默认 10 分钟）自动退出，不阻塞系统
* **非侵入式**：通过 Claude Code 原生 Hooks 实现，不修改 Claude Code 核心

## 📋 故障排除

### LLM API 超时

检查网络连接，确保能访问 `dashscope.aliyuncs.com`。系统会自动降级到规则模式。

### 命令未被执行

1. 检查 Claude Code 是否处于 idle 状态（钉钉应收到 "等待输入" 通知）
2. 检查命令文件是否正确写入：`ls {project}/.claude/.openhermit/commands/`
3. 检查 IPC 服务是否运行：`curl http://127.0.0.1:31337/health`

### 钉钉连接问题

检查 AppKey 和 AppSecret 是否正确，网络是否正常。

### Hooks 未生效

1. 确认已执行 `openhermit init` 初始化配置
2. 检查 `~/.claude/settings.json` 中是否包含 openhermit hooks
3. 重启 Claude Code 后再试

## 📦 项目结构

```
openhermit/
├── src/
│   ├── index.js              # 入口（CLI 命令入口）
│   ├── commands/             # CLI 命令模块
│   │   ├── index.js          # 命令路由
│   │   ├── init.js           # init 命令（注入 hooks）
│   │   └── uninit.js         # uninit 命令（移除 hooks）
│   ├── config/               # 配置加载与验证
│   │   └── index.js
│   ├── core/                 # 核心模块
│   │   ├── index.js          # 模块导出
│   │   ├── ipc-server.js     # IPC 服务（接收 Hook 事件）
│   │   ├── hook-handler.js   # Hook 事件处理器
│   │   ├── hook-context.js   # Hook 上下文存储
│   │   └── command-manager.js # 命令管理器（双向通信）
│   ├── hooks/                # Claude Code Hook 脚本
│   │   ├── pre-tool.sh       # PreToolUse Hook
│   │   ├── notification.sh   # Notification Hook（含轮询逻辑）
│   │   └── stop.sh           # Stop Hook
│   ├── channel/              # 通讯通道
│   │   └── dingtalk.js       # 钉钉 Stream SDK 封装
│   ├── llm/                  # LLM 服务（阿里云百炼）
│   │   ├── index.js          # 入口
│   │   ├── client.js         # API 客户端
│   │   ├── interactionAnalyzer.js  # 交互分析
│   │   ├── interactionContext.js   # 交互上下文
│   │   └── prompts/          # Prompt 模板
│   │       ├── index.js      # 统一导出
│   │       ├── intent.js     # 意图解析
│   │       ├── interaction.js # 交互检测
│   │       ├── hook-event.js # Hook 事件解析
│   │       └── format.js     # 格式化
│   └── utils/                # 工具
│       └── logger.js         # 日志封装
└── tests/                    # 测试文件
    ├── commands.test.js      # CLI 命令测试
    ├── dingtalk-channel.test.js  # 钉钉通道测试
    ├── hook-handler.test.js  # Hook 处理测试
    └── ipc-server.test.js    # IPC 服务测试
```

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**钉钉开放平台**: https://open-dev.dingtalk.com/
**阿里云百炼**: https://bailian.console.aliyun.com/
