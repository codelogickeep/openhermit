# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenHermit (开源寄居蟹) 是一个基于 Node.js 的 **纯监控模式** 服务，通过 Claude Code 原生 Hooks 机制实现与钉钉的双向通信。

**核心特性：**
- **Shadow Hook Injection** - 利用 Claude Code 原生 Hooks 实现精确的交互状态检测
- **双向通信** - 钉钉 ← → OpenHermit ← → Claude Code
- **智能交互模式** - 集成阿里云百炼平台，支持自然语言转命令
- **按需发送策略** - 静默模式减少消息打扰，关键时刻触发通知

**版本：** v2.1.10 (纯监控模式)

## Tech Stack

| 依赖 | 版本 | 用途 |
|------|------|------|
| `dingtalk-stream-sdk-nodejs` | ^2.0.4 | 钉钉 WebSocket 长连接 |
| `axios` | ^1.6.0 | HTTP 客户端（百炼 API 调用） |
| `lodash.debounce` | ^4.0.8 | 防抖函数 |
| `dotenv` | ^16.3.1 | 环境配置加载 |
| `pino` | ^8.17.2 | 结构化日志 |
| `pino-pretty` | ^10.3.1 | 日志格式化 |
| `vitest` | ^1.2.0 | 单元测试框架 |

**运行环境：** Node.js v20+ / macOS & Linux

## Directory Structure

```
openhermit/
├── src/
│   ├── index.js              # 程序入口（CLI 命令路由 + 监控服务）
│   │
│   ├── commands/             # CLI 命令模块
│   │   ├── index.js          # 命令路由
│   │   ├── init.js           # init 命令（注入 hooks 到 ~/.claude/）
│   │   └── uninit.js         # uninit 命令（移除 hooks）
│   │
│   ├── config/
│   │   └── index.js          # 配置加载与验证
│   │
│   ├── core/                 # 核心模块
│   │   ├── index.js          # 模块导出
│   │   ├── ipc-server.js     # IPC 服务（接收 Hook 事件）
│   │   ├── hook-context.js   # Hook 上下文存储
│   │   ├── hook-handler.js   # Hook 事件处理器
│   │   └── command-manager.js # 命令管理器（双向通信）
│   │
│   ├── hooks/                # Claude Code Hook 脚本
│   │   ├── pre-tool.sh       # PreToolUse Hook
│   │   ├── notification.sh   # Notification Hook（含命令轮询）
│   │   └── stop.sh           # Stop Hook
│   │
│   ├── channel/
│   │   └── dingtalk.js       # 钉钉 Stream SDK 封装（含发送策略）
│   │
│   ├── llm/                  # LLM 服务
│   │   ├── index.js          # 入口
│   │   ├── client.js         # 百炼 API 客户端
│   │   ├── interactionAnalyzer.js  # 交互分析器
│   │   ├── interactionContext.js   # 交互上下文
│   │   └── prompts/          # Prompt 模板
│   │       ├── index.js      # 统一导出
│   │       ├── intent.js     # 意图解析
│   │       ├── interaction.js # 交互检测
│   │       ├── hook-event.js # Hook 事件解析
│   │       └── format.js     # 格式化
│   │
│   └── utils/
│       └── logger.js         # Pino 日志封装
│
├── tests/                    # 测试文件
│   ├── commands.test.js      # CLI 命令测试
│   ├── dingtalk-channel.test.js  # 钉钉通道测试
│   ├── hook-handler.test.js  # Hook 处理器测试
│   └── ipc-server.test.js    # IPC 服务测试
│
├── docs/                     # 文档
│   ├── ARCHITECTURE.md       # 系统架构设计（主要文档）
│   ├── prd.md                # 产品需求文档（历史）
│   └── plans/                # 功能设计文档
│       ├── smart-interaction/
│       ├── 2026-03-03-Shadow-Hook-Injection-design.md
│       └── 2026-03-24-bidirectional-communication-design.md
│
├── .env.example              # 环境配置模板
├── package.json
└── vitest.config.js
```

## Core Architecture

### 双向通信架构

```
钉钉 ← → OpenHermit ← → Claude Code
```

**通信流程：**
1. Claude Code 执行任务完成 → 进入 idle 状态
2. OpenHermit 推送 "等待输入" 通知到钉钉
3. 用户在钉钉发送指令
4. OpenHermit 写入命令文件（`.claude/.openhermit/commands/`）
5. notification.sh Hook 轮询检测到命令文件
6. 命令内容输出到 stdout → Claude Code 执行
7. 执行完成后再次进入 idle，等待下一条指令

### Shadow Hook Injection

通过 `openhermit init` 将 Hooks 配置注入到 `~/.claude/settings.json`：

| Hook 类型 | 触发时机 | 用途 |
|-----------|----------|------|
| `PreToolUse` | 工具执行前 | 检测需要确认的操作 |
| `Notification` | 状态通知时 | 检测 idle 状态、轮询等待钉钉命令 |
| `Stop` | 任务完成时 | 精确通知任务完成 |

**关键点：**
- 不修改用户任何文件，配置注入到 `~/.claude/settings.json`
- Hook 事件通过 IPC Server（端口 31337）接收
- 用户项目目录完全不受影响

### Hook 交互状态机

```
IDLE ──(用户发送任务)──► RUNNING
         │
         ├──(PreToolUse Hook)──► WAITING_CONFIRM ──(用户确认)──► RUNNING
         │
         ├──(Notification Hook)──► WAITING_INPUT ──(用户输入)──► RUNNING
         │
         └──(Stop Hook)──► COMPLETED ──(重置)──► IDLE
```

### 智能交互模式

通过阿里云百炼平台（通义千问）增强交互：

- **自然语言转命令**：用户描述需求，系统自动启动 Claude Code
- **终端输出格式化**：转换为 Markdown，适配移动端
- **智能选择交互**：检测选项列表，支持多种回复方式

### 按需发送策略

- **静默模式**：默认不实时发送终端输出，缓冲在本地
- **触发发送**：交互提示、任务完成、错误等关键时刻
- **手动查看**：`-status` 命令查看缓冲内容

## Commands

```bash
# 安装依赖
npm install

# 启动监控服务
npm start

# 开发模式（热重载）
npm run dev

# 运行测试
npm test

# 测试监视模式
npm run test:watch
```

### CLI 命令

```bash
# 初始化 hooks 配置（一次性，全局注入）
openhermit init

# 强制重新初始化
openhermit init --force

# 移除 hooks 配置
openhermit uninit

# 启动监控服务
openhermit

# 显示帮助
openhermit -h
```

**init 命令说明：**
- `openhermit init` - 全局初始化，注入 hooks 到 `~/.claude/settings.json`（推荐）
- `openhermit init ~/projects/myapp` - 为指定项目初始化

## Configuration

创建 `.env` 文件（参考 `.env.example`）：

**必填配置：**
```bash
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
```

**可选配置：**
```bash
# 钉钉用户 ID（启动时主动推送）
DINGTALK_USER_ID=your_staff_id

# API 代理
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_BASE_URL=https://your-proxy.com/v1

# 智能交互（阿里云百炼）
DASHSCOPE_API_KEY=sk-xxx
DASHSCOPE_MODEL=qwen3.5-flash

# IPC 端口
HERMIT_IPC_PORT=31337
```

## Testing

测试使用 Vitest 框架：

| 测试文件 | 说明 |
|---------|------|
| `commands.test.js` | CLI 命令测试（init/uninit） |
| `dingtalk-channel.test.js` | 钉钉通道测试 |
| `hook-handler.test.js` | Hook 处理器测试 |
| `ipc-server.test.js` | IPC 服务测试 |

```bash
npm test  # 运行所有测试
```

## Environment Requirements

- Node.js v20+
- macOS 或 Linux
- 有效的钉钉 AppKey 和 AppSecret

### Troubleshooting

**钉钉连接超时：**
- 检查网络/代理设置
- 验证 AppKey 和 AppSecret
- 连接失败会自动降级到 mock 模式

**IPC 端口被占用：**
```bash
# 查找占用进程
lsof -i :31337

# 终止进程
kill -9 <PID>
```

## Related Documentation

- `docs/ARCHITECTURE.md` - 完整系统架构设计文档
- `docs/plans/smart-interaction/DESIGN.md` - 智能交互功能设计
- `docs/plans/2026-03-03-Shadow-Hook-Injection-design.md` - Hook 注入设计
- `docs/plans/2026-03-24-bidirectional-communication-design.md` - 双向通信设计
