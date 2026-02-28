# 🦀 OpenHermit (开源寄居蟹)

> A Lightweight Remote PTY Bridge for Claude Code & Local AI Agents.
> 让你的本地 AI 编程助手"长出"移动端的触角。

[![npm version](https://img.shields.io/npm/v/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
[![npm downloads](https://img.shields.io/npm/dm/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)

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
  * 前往 [钉钉开放平台](https://open-dev.dingtalk.com/) 创建企业内部应用获取

### 方式一：通过 npm 安装（推荐）

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

# 启动
openhermit
```

### 方式二：从源码安装

```bash
# 克隆项目
git clone https://github.com/codelogickeep/openhermit.git
cd openhermit

# 安装依赖
npm install
```

### 配置环境变量

创建 `.env` 文件（npm 全局安装用户建议放在 `~/.openhermit/` 目录）：

```bash
# 钉钉配置（必填）
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret

# 用户 ID（可选，用于启动时主动推送消息）
# 首次启动后，从日志中获取 senderStaffId 后填入
# DINGTALK_USER_ID=your_sender_staff_id

# 工作目录白名单（必填）
# 只允许在此目录下操作
ALLOWED_ROOT_DIR=/Users/xxx/projects

# API 代理配置（可选）
# ANTHROPIC_API_KEY=sk-ant-xxx
# ANTHROPIC_BASE_URL=https://your-proxy.com/v1
```

### 获取 senderStaffId（可选）

如果需要在服务启动时主动推送消息给你，需要配置 `DINGTALK_USER_ID`：

1. 首次启动应用
2. 在钉钉发送任意消息给机器人
3. 查看控制台输出，找到 `senderStaffId` 字段：
   ```
   === DingTalk 消息详情 ===
   {
     "senderStaffId": "122425200536277570",
     ...
   }
   =========================
   ```
4. 将获取到的 ID 填入 `.env` 文件的 `DINGTALK_USER_ID` 中
5. 重启应用

### 启动应用

**npm 全局安装：**
```bash
openhermit
```

**源码安装：**
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

### 在钉钉中使用

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
