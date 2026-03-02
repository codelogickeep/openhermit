# 🦀 OpenHermit (开源寄居蟹)

> A Lightweight Remote PTY Bridge for Claude Code & Local AI Agents.
> 让你的本地 AI 编程助手"长出"移动端的触角。

[![npm version](https://img.shields.io/npm/v/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
[![npm downloads](https://img.shields.io/npm/dm/@codelogickeep/open-hermit.svg)](https://www.npmjs.com/package/@codelogickeep/open-hermit)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)

## 💡 什么是 OpenHermit？

随着 Claude Code 等原生 CLI Agent 的爆发，开发者可以在本地拥有极强的代码上下文和执行权限。但对于配置了第三方模型服务或无法使用官方云端联动的开发者来说，离开电脑桌，Agent 就断了线。

**OpenHermit（开源寄居蟹）** 是一个基于 Node.js 的轻量级桥接服务。它利用 `node-pty` 技术"寄居"在 Claude Code 等 CLI 外壳之上，将本地终端的输入输出流进行净化、格式化与封装，最终通过 WebSocket 安全地穿透到你的手机通讯软件中。

**v1.1 新增智能交互模式**：集成阿里云百炼平台，支持自然语言直接启动 Claude Code，终端输出自动转换为 Markdown 格式，让移动端体验更加友好。

## ✨ 核心特性

* 🚀 **纯内网穿透：** 基于钉钉 Stream 模式（WebSocket），本地机器无需暴露任何端口
* 🐚 **完美的 PTY 欺骗：** 完美保留 Claude Code 原生的终端交互体验和环境变量
* 🛡️ **HITL 安全授权：** 自动拦截高危命令，转化为交互式卡片等待确认
* 🧹 **终端流净化：** 自动剥离 ANSI 颜色码、动画，转换为干净的 Markdown
* 🤖 **智能交互模式：** 自然语言直接启动 Claude Code，无需手动输入命令
* 📱 **移动端优化：** 终端输出自动格式化，适配手机屏幕阅读

## 🎯 使用场景

* **下班通勤：** 地铁上用手机让本地 Agent 查看代码、跑测试
* **远程运维：** 周末不在电脑旁，通过手机诊断系统问题
* **随时随地：** 任何有网络的地方，都能访问你的本地开发环境

## 🛠️ 快速开始

### 前置要求

* Node.js v18+
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
ALLOWED_ROOT_DIR=/Users/xxx/projects

# ===== 智能交互模式（推荐）=====
# 启用后可直接用自然语言与 Claude Code 交互
DASHSCOPE_API_KEY=sk-xxx                    # 阿里云百炼 API Key
DASHSCOPE_MODEL=qwen3.5-flash               # 模型（可选）

# ===== 可选配置 =====
# DINGTALK_USER_ID=your_staff_id            # 启动时主动推送消息
# ANTHROPIC_API_KEY=sk-ant-xxx              # API 代理
# ANTHROPIC_BASE_URL=https://your-proxy.com/v1
```

**获取百炼 API Key**：访问 [阿里云百炼平台](https://bailian.console.aliyun.com/)

### 启动

```bash
openhermit
```

启动成功后显示：

```
=== OpenHermit 环境信息 ===
平台: darwin
Node.js: v18.x.x
✅ 环境检查通过
[INFO] 智能交互模式已启用
[INFO] LLM 客户端初始化成功 model: "qwen3.5-flash"
[INFO] OpenHermit 启动完成
```

## 📱 使用方式

### OpenHermit 命令（- 前缀）

| 命令 | 说明 |
|------|------|
| `-cd <目录>` | 切换工作目录 |
| `-ls` | 查看可选目录 |
| `-claude [任务]` | 启动 Claude Code |
| `-status` | 查看执行状态 |
| `-help` | 查看帮助 |

### Claude 内容

不带 `-` 前缀的所有内容都会原封不动发送给 Claude 终端：

```
你: 帮我分析一下代码结构
Claude: [输出分析结果]

你: /commit
Claude: [执行提交]

你: y
Claude: [确认操作]
```

> ⚠️ 如果 Claude 终端未启动，会提示错误信息。使用 `-claude` 启动。

### 使用流程

```
1. 发送 -ls 查看可选目录
2. 发送 -cd my-project 切换到项目目录
3. 发送 -claude 启动 Claude Code
4. 发送你的需求给 Claude
```

## 🔒 安全机制

* **目录白名单**：只能操作 `ALLOWED_ROOT_DIR` 目录及其子目录
* **HITL 审批**：危险命令需要钉钉确认才能执行
* **降级保护**：LLM 服务不可用时自动降级到规则模式

## 📋 故障排除

### LLM API 超时

检查网络连接，确保能访问 `dashscope.aliyuncs.com`。系统会自动降级到规则模式。

### node-pty 安装失败

```bash
npm rebuild node-pty
```

### 钉钉连接问题

检查 AppKey 和 AppSecret 是否正确，网络是否正常。

## 📦 项目结构

```
openhermit/
├── src/
│   ├── index.js          # 入口
│   ├── config/           # 配置
│   ├── pty/              # PTY 引擎
│   ├── channel/          # 钉钉通道
│   ├── purifier/         # 流净化器
│   ├── llm/              # LLM 服务（百炼）
│   ├── intent/           # 意图解析
│   ├── formatter/        # 输出格式化
│   ├── selector/         # 选择检测
│   └── utils/            # 工具
└── tests/                # 测试（117 用例）
```

## 📄 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**钉钉开放平台**: https://open-dev.dingtalk.com/
**阿里云百炼**: https://bailian.console.aliyun.com/
