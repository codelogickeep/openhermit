# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenHermit (开源寄居蟹) 是一个基于 Node.js 的本地 PTY 桥接服务，将本地 CLI 工具（以 Claude Code 为主）与移动端通讯平台（钉钉企业内部机器人 Stream 模式）连接起来，实现公网无缝访问本地 AI Agent。

**核心特性：**
- **Shadow Hook Injection** - 利用 Claude Code 原生 Hooks 实现精确的交互状态检测
- **智能交互模式** - 集成阿里云百炼平台，支持自然语言转命令
- **按需发送策略** - 静默模式减少消息打扰，关键时刻触发通知
- **多层安全防护** - 命令安全检测、注入防护、敏感路径保护

**状态：** Phase 1 (钉钉集成) - 已实现

## Tech Stack

| 依赖 | 版本 | 用途 |
|------|------|------|
| `node-pty` | ^1.1.0 | 伪终端模拟 |
| `dingtalk-stream-sdk-nodejs` | ^2.0.4 | 钉钉 WebSocket 长连接 |
| `axios` | ^1.6.0 | HTTP 客户端（百炼 API 调用） |
| `strip-ansi` | ^6.0.1 | ANSI 码剥离 |
| `lodash.debounce` | ^4.0.8 | 防抖函数 |
| `dotenv` | ^16.3.1 | 环境配置加载 |
| `pino` | ^8.17.2 | 结构化日志 |
| `pino-pretty` | ^10.3.1 | 日志格式化 |
| `vitest` | ^1.2.0 | 单元测试框架 |

**运行环境：** Node.js v18+ / macOS & Linux

## Directory Structure

```
openhermit/
├── src/
│   ├── index.js              # 程序入口（OpenHermit 主类）
│   │
│   ├── config/
│   │   └── index.js          # 配置加载、验证、环境检查
│   │
│   ├── core/                 # 核心模块
│   │   ├── index.js          # 模块入口
│   │   ├── message-handler.js   # 消息处理路由
│   │   ├── system-commands.js   # 系统命令（-cd, -ls, -status 等）
│   │   ├── security.js          # 命令安全检测器
│   │   ├── task-manager.js      # 任务状态管理
│   │   ├── terminal-logger.js   # 终端日志管理
│   │   ├── hitl-controller.js   # HITL 控制器
│   │   ├── ipc-server.js        # IPC 服务（接收 Hook 事件）
│   │   ├── hook-context.js      # Hook 上下文存储
│   │   └── hook-handler.js      # Hook 事件处理器
│   │
│   ├── hooks/                # Claude Code Hook 脚本
│   │   ├── pre-tool.sh       # PreToolUse Hook
│   │   ├── notification.sh   # Notification Hook
│   │   └── stop.sh           # Stop Hook
│   │
│   ├── pty/
│   │   ├── engine.js         # node-pty 封装（PTY 生命周期管理）
│   │   └── envBuild.js       # 环境变量构建（含影子配置注入）
│   │
│   ├── channel/
│   │   └── dingtalk.js       # 钉钉 Stream SDK 封装（含发送策略）
│   │
│   ├── purifier/
│   │   ├── stripper.js       # 终端流净化（ANSI、动画过滤）
│   │   └── hitl.js           # HITL 检测器（危险命令检测）
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
│   ├── intent/               # 意图解析
│   │   ├── index.js          # 入口
│   │   └── parser.js         # 意图解析逻辑
│   │
│   ├── formatter/            # 输出格式化
│   │   ├── index.js          # 入口
│   │   ├── markdown.js       # Markdown 转换
│   │   └── patterns.js       # 终端模式识别
│   │
│   ├── selector/             # 选择检测
│   │   ├── index.js          # 入口
│   │   ├── detector.js       # 选择提示检测
│   │   └── handler.js        # 用户选择处理
│   │
│   └── utils/
│       └── logger.js         # Pino 日志封装
│
├── tests/                    # 测试文件（211 个测试用例）
│   ├── envBuild.test.js      # 环境变量构建
│   ├── stripper.test.js      # 终端净化器
│   ├── hitl.test.js          # HITL 检测
│   ├── security.test.js      # 命令安全检测
│   ├── integration.test.js   # 集成测试
│   ├── simulate-dingtalk.test.js
│   ├── user-flow.test.js
│   ├── dingtalk-channel.test.js
│   └── smart-interaction/    # 智能交互测试
│       ├── formatter.test.js
│       ├── intent.test.js
│       ├── llm.test.js
│       └── selector.test.js
│
├── docs/                     # 文档
│   ├── ARCHITECTURE.md       # 系统架构设计（主要文档）
│   ├── prd.md                # 产品需求文档
│   └── plans/                # 功能设计文档
│       ├── smart-interaction/
│       └── 2026-03-03-Shadow-Hook-Injection-design.md
│
├── .env.example              # 环境配置模板
├── package.json
└── vitest.config.js
```

## Core Architecture

### 数据流

**下行链路（钉钉 → 终端）：**
1. 用户在钉钉发送消息（文本或语音）
2. `channel/dingtalk.js` 收到消息，语音使用钉钉内置识别
3. `MessageHandler.handleChannelText()` 处理：
   - HITL 激活状态：优先处理审批回复
   - 系统命令（`-` 前缀）：`SystemCommands.handle()` 处理
   - 无前缀消息：Claude 活跃则转发，空闲则 LLM 意图识别

**上行链路（终端 → 钉钉）：**
1. PTY 输出 → Purifier（ANSI 剥离）→ TerminalLogger（日志记录）
2. TaskManager 更新任务状态
3. HITL Detector 检测危险命令审批模式
4. 智能发送策略：默认静默，关键时刻触发

### Shadow Hook Injection

利用 Claude Code 原生 Hooks 机制，在 PTY 启动前注入"影子配置"：

| Hook 类型 | 触发时机 | 用途 |
|-----------|----------|------|
| `PreToolUse` | 工具执行前 | 检测需要确认的操作 |
| `Notification` | 状态通知时 | 检测等待输入、空闲状态 |
| `Stop` | 任务完成时 | 精确通知任务完成 |

**关键点：**
- 不修改用户任何文件，影子配置与用户配置自动合并
- Hook 事件通过 IPC Server（端口 31337）接收
- 支持 `CLAUDE_CONFIG_DIR` 环境变量注入

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
- **智能选择交互**：检测选项列表，支持数字/文本/中文数字回复

### 按需发送策略

- **静默模式**：默认不实时发送终端输出，缓冲在本地
- **触发发送**：交互提示、任务完成、错误等关键时刻
- **手动查看**：`-status` 命令查看缓冲内容

### 安全防护

**命令安全检测（四级别风险评估）：**

| 等级 | 说明 | 处理方式 |
|------|------|---------|
| LOW | 安全 | 允许执行，记录日志 |
| MEDIUM | 中风险 | 允许执行，警告用户 |
| HIGH | 高风险 | 需要用户确认（HITL） |
| CRITICAL | 危险 | 拒绝执行 |

**检测内容：**
- 命令注入（分号、管道、命令替换、eval）
- 编码绕过（base64、xxd）
- 反向 Shell
- 权限提升（sudo、su）
- 敏感路径（/etc、/root、~/.ssh）
- 远程执行（curl | bash）

## Commands

```bash
npm install          # 安装依赖
npm start           # 启动服务
npm run dev         # 开发模式（热重载）
npm test            # 运行测试
npm run test:watch  # 测试监视模式
```

## Configuration

创建 `.env` 文件（参考 `.env.example`）：

**必填配置：**
```bash
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
ALLOWED_ROOT_DIR=/Users/xxx/projects    # 工作目录白名单
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

# Shadow Hook Injection
HERMIT_IPC_PORT=31337           # IPC 端口（默认 31337）
```

## System Commands

| 命令 | 说明 |
|-----|------|
| `-cd <目录>` | 切换工作目录 |
| `-ls` | 查看可选目录 |
| `-claude [任务]` | 启动 Claude Code |
| `-status` | 查看当前状态和进度 |
| `-help` | 查看帮助 |

## Testing

测试使用 Vitest 框架，共 **211** 个测试用例：

| 测试文件 | 数量 | 说明 |
|---------|------|------|
| `envBuild.test.js` | 5 | 环境变量构建 |
| `stripper.test.js` | 19 | 终端净化器 |
| `hitl.test.js` | 10 | HITL 检测 |
| `security.test.js` | 45 | 命令安全检测 |
| `integration.test.js` | 16 | 集成测试 |
| `simulate-dingtalk.test.js` | 16 | 钉钉模拟 |
| `user-flow.test.js` | 8 | 用户流程 |
| `dingtalk-channel.test.js` | 19 | 钉钉通道 |
| `smart-interaction/formatter.test.js` | 28 | 格式化器 |
| `smart-interaction/intent.test.js` | 22 | 意图解析 |
| `smart-interaction/llm.test.js` | 3 | LLM 客户端 |
| `smart-interaction/selector.test.js` | 20 | 选择器 |

```bash
npm test  # 运行所有测试
```

## Environment Requirements

- Node.js v18+
- macOS 或 Linux
- 有效的钉钉 AppKey 和 AppSecret
- 有效的 ALLOWED_ROOT_DIR（必须存在）

### Troubleshooting

**node-pty 安装问题：**
```bash
npm rebuild node-pty
# 或
npm install node-pty --build-from-source
```

**钉钉连接超时：**
- 检查网络/代理设置
- 验证 AppKey 和 AppSecret
- 连接失败会自动降级到 mock 模式

## Related Documentation

- `docs/ARCHITECTURE.md` - 完整系统架构设计文档
- `docs/plans/smart-interaction/DESIGN.md` - 智能交互功能设计
- `docs/plans/2026-03-03-Shadow-Hook-Injection-design.md` - Hook 注入设计
