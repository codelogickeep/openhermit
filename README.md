# 🦀 OpenHermit (开源寄居蟹)

> A Lightweight Remote PTY Bridge for Claude Code & Local AI Agents.
> 让你的本地 AI 编程助手"长出"移动端的触角。

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)
![Status: Alpha](https://img.shields.io/badge/Status-Phase%201%20(DingTalk)-orange.svg)

## 💡 什么是 OpenHermit？

随着 Claude Code 等原生 CLI Agent 的爆发，开发者可以在本地拥有极强的代码上下文和执行权限（例如运行基于 MCP 的各类服务）。但对于配置了第三方模型服务或无法使用官方云端联动的开发者来说，离开电脑桌，Agent 就断了线。

**OpenHermit（开源寄居蟹）** 是一个基于 Node.js 的轻量级桥接服务。它本身不具备 AI 能力，而是利用 `node-pty` 技术"寄居"在 Claude Code 等 CLI 外壳之上，将本地终端的输入输出流进行净化、防抖与封装，最终通过 WebSocket（如钉钉 Stream 模式）安全地穿透到你的手机通讯软件中。

无需内网穿透，无需公网 IP，即可在手机上随时随地唤醒你强大的本地开发机。

## ✨ 核心特性

* 🚀 **纯内网穿透：** 基于钉钉 Stream 模式（WebSocket），本地机器无需暴露任何端口。
* 🐚 **完美的 PTY 欺骗：** 完美保留 Claude Code 原生的终端交互体验、环境变量（包括你所有的 MCP Server 配置）。
* 🛡️ **HITL (人在回路) 安全授权：** 自动拦截终端里高危的 `(y/N)` 执行请求，并在手机端转化为交互式卡片（ActionCard），点击确认后才放行本地命令。
* 🧹 **终端流净化引擎：** 自动剥离 ANSI 颜色码、清屏符和 Loading 动画，将混乱的终端流转换为干净的移动端 IM 文本。

## 场景案例 (Use Cases)

* **下班通勤时：** 在地铁上突然想起代码问题，掏出手机在钉钉发一句："帮我看一下当前多模块 Java 工程里，WMS 库存调度模块的最新 Git 状态，并跑一下单元测试。"
* **远程运维诊断：** 周末不在电脑旁，通过手机让本地机器上的 Agent 读取 ERP 系统的异常日志，并生成修复 SQL 的建议。

## 🛠️ 快速开始

### 前置要求

* Node.js v18+
* macOS 或 Linux
* 钉钉企业内部应用（AppKey 和 AppSecret）

### 1. 克隆项目

```bash
git clone https://github.com/codelogickeep/openhermit.git
cd openhermit
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```bash
# 钉钉配置（必填）
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret

# 工作目录白名单（必填）
# 只允许在此目录下操作
ALLOWED_ROOT_DIR=/Users/xxx/projects

# API 代理配置（可选）
# ANTHROPIC_API_KEY=sk-ant-xxx
# ANTHROPIC_BASE_URL=https://your-proxy.com/v1
```

### 4. 启动应用

```bash
npm start
```

启动成功后会显示：

```
=== OpenHermit 环境信息 ===
平台: darwin
Node.js: v18.x.x
Shell: /bin/zsh
CPU: x 核
内存: xxGB

✅ 环境检查通过

[INFO] 初始化 OpenHermit...
[INFO] 启动 PTY
[INFO] 连接钉钉 WebSocket...
[INFO] OpenHermit 启动完成
```

### 5. 在钉钉中使用

首次连接会收到欢迎消息：

```
🦀 欢迎使用 OpenHermit

当前工作目录: /Users/xxx/projects
可选目录:
  - /Users/xxx/projects

命令:
  /cd <目录>  切换工作目录
  /ls         查看可选目录
  /restart    重启 Claude Code

请先使用 /cd 切换到项目目录，然后输入 claude 启动。
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `/cd <目录>` | 切换到指定目录（必须在白名单内） |
| `/ls` | 查看当前目录和白名单下的可选目录 |
| `/restart` | 重启 Claude Code |
| `claude` | 启动 Claude Code（首次使用） |

### 使用流程

1. 发送 `/cd <项目目录>` 切换到工作目录
2. 发送 `claude` 启动 Claude Code
3. 发送你的开发需求，如 "帮我看看这个项目的代码结构"
4. Claude Code 会通过钉钉回复你

## ⚠️ 安全限制

* 工作目录限制：只能操作 `ALLOWED_ROOT_DIR` 目录及其子目录
* HITL 审批：危险命令（如删除文件）需要你在钉钉上确认才能执行

## 📋 故障排除

### node-pty 安装失败

```bash
npm rebuild node-pty
```

### 钉钉连接超时

检查网络/代理设置，或配置 HTTP_PROXY 环境变量。应用会自动进入模拟模式进行本地测试。

### 查看日志

```bash
npm start
# 日志会直接输出到控制台
```

## 📦 项目结构

```
openhermit/
├── src/
│   ├── index.js          # 入口
│   ├── config/           # 配置
│   ├── pty/              # PTY 引擎
│   ├── channel/          # 钉钉通道
│   ├── purifier/         # 流净化器
│   └── utils/            # 工具
├── tests/                # 测试
└── package.json
```

## 📄 许可证

MIT
