# 🦀 OpenHermit (开源寄居蟹) - 系统架构设计文档 (Phase 1)

## 1. 系统概述 (System Overview)

OpenHermit 是一个基于 Node.js 的本地 PTY 桥接服务。它的核心使命是将本地强交互的 CLI 工具（以 Claude Code 为主）与移动端通讯软件（钉钉企业内部机器人 Stream 模式）连接起来。
实现公网无缝访问本地 AI Agent，并接管终端流的富文本清理与 `HITL (人在回路)` 权限拦截。

## 2. 核心依赖组件 (Core Dependencies)

在初始化 `package.json` 时，你的核心依赖库如下：

* **`node-pty`**: (核心引擎) 用于派生伪终端，完美欺骗 Claude Code 进程，使其输出带有颜色和交互提示的原始数据流。
* **`dingtalk-stream-sdk-nodejs`**: (通道网关) 钉钉官方 SDK，采用 WebSocket 长连接，实现无公网 IP 穿透。
* **`strip-ansi`**: (文本净化器) 正则剔除终端输出中的 ANSI 颜色代码、清屏控制符。
* **`lodash.debounce`**: (流式防抖) 将 PTY 高频的碎裂输出（按字符/行）缓冲聚合，避免触发钉钉 API 的限流策略。
* **`dotenv`**: 环境配置加载，用于注入钉钉密钥以及第三方模型（如 MiniMax）的 API 代理地址。
* **`pino` / `winston` (可选)**: 结构化日志。作为后台运行的 Agent 连接器，需要有清晰的日志记录本地系统的状态。

## 3. 目录结构设计 (Directory Structure)

为了保证项目的可扩展性（未来可能支持微信、Telegram，或者支持其他 CLI 工具），我们采用标准的分层架构：

```text
openhermit/
├── .env                  # 环境配置文件 (钉钉密钥、MiniMax API/BaseURL)
├── package.json
├── src/
│   ├── index.js          # 程序的统一入口 (启动 PTY 和 DingTalk 监听)
│   ├── config/
│   │   └── index.js      # 配置加载层，解析 .env 并组装透传给子进程的 process.env
│   ├── pty/
│   │   ├── engine.js     # 封装 node-pty 的启动、销毁与写入逻辑
│   │   └── envBuild.js   # 环境变量组装逻辑 (重点：将 MiniMax 配置悄悄注入)
│   ├── channel/
│   │   └── dingtalk.js   # 钉钉 Stream SDK 的初始化、消息接收、防抖发送、卡片推送
│   ├── purifier/
│   │   ├── stripper.js   # 终端流净化逻辑 (去除转圈动画、ANSI 码)
│   │   └── hitl.js       # 人在回路 (Human-in-the-loop) 拦截器：正则匹配 (y/n)
│   └── utils/
│       └── logger.js     # 系统日志工具
└── README.md

```

## 4. 核心逻辑与数据流 (Core Logic Flow)

### 4.1 环境变量静默注入 (The Injection)

Claude Code 默认使用 Anthropic 官方协议。在 `src/pty/envBuild.js` 中，我们需要构造一个特殊的 `env` 对象传给 `node-pty`：

1. 继承宿主机的 `process.env`（确保 `PATH`、Java 环境、Maven 配置、甚至你本地的 MCP Server 配置依然生效）。
2. 强行覆盖大模型相关的变量：注入 `ANTHROPIC_API_KEY` 和指向你 API 协议转换网关（如 OneAPI 映射到 MiniMax）的 `ANTHROPIC_BASE_URL`。

### 4.2 钉钉到终端的下行链路 (Inbound Flow)

1. 用户在钉钉发送：“帮我查一下 `wms-core` 模块最新的打包报错”。
2. `src/channel/dingtalk.js` 收到 Text 消息。
3. 判断是否为内置命令（如 `/cd` 切换目录，如果是则在 Node 侧处理）。
4. 如果是普通对话，直接调用 `pty.write('帮我查一下... \r')` 注入终端。

### 4.3 终端到钉钉的上行链路与拦截 (Outbound & HITL Flow - **最难点**)

`src/pty/engine.js` 监听到 Claude 的数据流 (`onData`)：

**第一关：Purifier (净化器)**

* 流入 `strip-ansi` 剥离颜色。
* 过滤极其高频的刷新字符（例如 `\b`, `\r`, 连续的 `...` 动画）。

**第二关：HITL Detector (权限拦截器)**

* 维护一个短暂的文本窗口 (Buffer)。
* 实时正则检测 Buffer 尾部是否包含诸如 `(y/n)`、`Allow` 等交互授权标识。
* **如果触发 HITL：**
* 立刻暂停向普通防抖队列输送数据。
* 调用 `channel` 发送一张 **钉钉 ActionCard (交互卡片)**，内容为“Claude 正在请求执行高危命令”，下方附带【同意执行 (y)】和【拒绝执行 (n)】两个按钮。
* 卡片按钮点击后，回调 webhook 或走 Stream 接收，将对应的字符写入 PTY，恢复终端执行。



**第三关：Debounce Broadcaster (防抖广播)**

* 如果未触发拦截，数据进入普通文本 Buffer。
* 使用 `lodash.debounce`，每隔 1.5 秒或 2 秒，将 Buffer 内拼接好的完整文本块，调用钉钉接口推送到手机端。推送后清空 Buffer。

## 5. 异常处理与保活机制 (Error Handling)

* **进程崩溃：** PTY 中的 Claude 进程可能因为大模型超时或复杂操作 `exit`。Node 服务需要监听到 `exit` 事件，向钉钉推送告警，并支持通过钉钉发送 `/restart` 命令重新拉起 PTY。
* **长文本截断：** 钉钉文本消息有长度限制。如果大模型一次性输出了超长代码，发送前需在 `channel` 层做分块处理（Chunking）。