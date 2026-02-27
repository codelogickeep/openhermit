# 🦀 OpenHermit (开源寄居蟹)
> A Lightweight Remote PTY Bridge for Claude Code & Local AI Agents.
> 让你的本地 AI 编程助手“长出”移动端的触角。

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)
![Status: Alpha](https://img.shields.io/badge/Status-Phase%201%20(DingTalk)-orange.svg)

## 💡 什么是 OpenHermit？
随着 Claude Code 等原生 CLI Agent 的爆发，开发者可以在本地拥有极强的代码上下文和执行权限（例如运行基于 MCP 的各类服务）。但对于配置了第三方模型服务或无法使用官方云端联动的开发者来说，离开电脑桌，Agent 就断了线。

**OpenHermit（开源寄居蟹）** 是一个基于 Node.js 的轻量级桥接服务。它本身不具备 AI 能力，而是利用 `node-pty` 技术“寄居”在 Claude Code 等 CLI 外壳之上，将本地终端的输入输出流进行净化、防抖与封装，最终通过 WebSocket（如钉钉 Stream 模式）安全地穿透到你的手机通讯软件中。

无需内网穿透，无需公网 IP，即可在手机上随时随地唤醒你强大的本地开发机。

## ✨ 核心特性
* 🚀 **纯内网穿透：** 基于钉钉 Stream 模式（WebSocket），本地机器无需暴露任何端口。
* 🐚 **完美的 PTY 欺骗：** 完美保留 Claude Code 原生的终端交互体验、环境变量（包括你所有的 MCP Server 配置）。
* 🛡️ **HITL (人在回路) 安全授权：** 自动拦截终端里高危的 `(y/N)` 执行请求，并在手机端转化为交互式卡片（ActionCard），点击确认后才放行本地命令。
* 🧹 **终端流净化引擎：** 自动剥离 ANSI 颜色码、清屏符和 Loading 动画，将混乱的终端流转换为干净的移动端 IM 文本。

## 场景案例 (Use Cases)
* **下班通勤时：** 在地铁上突然想起代码问题，掏出手机在钉钉发一句：“帮我看一下当前多模块 Java 工程里，WMS 库存调度模块的最新 Git 状态，并跑一下单元测试。”
* **远程运维诊断：** 周末不在电脑旁，通过手机让本地机器上的 Agent 读取 ERP 系统的异常日志，并生成修复 SQL 的建议。

## 🛠️ 快速开始 (WIP)
... (待补充安装步骤)
