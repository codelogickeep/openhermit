# OpenHermit 代码审查报告

> 审查日期: 2026-02-28
> 审查范围: 全部源代码 vs 设计文档 (implement-pty-bridge)

## 一、功能完整性对照表

| 模块 | 需求项 | 状态 | 说明 |
|------|--------|------|------|
| **通道网关** | 钉钉 Stream 连接 | ✅ | 已实现，含 mock 降级 |
| | 入站消息接收 | ✅ | 已实现 |
| | 内置命令 /cd | ✅ | 含白名单检查 |
| | 内置命令 /ls | ✅ | 已实现 |
| | 内置命令 /restart | ✅ | 已实现 |
| | 防抖发送 (1500ms) | ✅ | 使用 lodash.debounce |
| | 欢迎消息 | ✅ | 首次连接时发送 |
| | **消息分片 (>2000字节)** | ❌ **缺失** | 设计文档明确要求，但代码未实现 |
| | **ActionCard 审批卡片** | ❌ **缺失** | 当前仅发送纯文本提示，非钉钉 ActionCard |
| | **ActionCard 按钮回调** | ❌ **缺失** | 未注册卡片回调监听 |
| **PTY 桥接** | PTY 进程启动 | ✅ | 已实现 |
| | 环境变量注入 | ✅ | 继承 host env + API 配置覆盖 |
| | 双向数据流 | ✅ | 已实现 |
| | 进程生命周期管理 | ✅ | exit 事件 + restart |
| | 工作目录白名单 | ⚠️ **有漏洞** | 存在路径前缀绕过风险 |
| **流净化器** | ANSI 码剥离 | ✅ | strip-ansi |
| | 控制字符过滤 | ✅ | \b, \r 过滤 |
| | 加载动画过滤 | ✅ | spinner 字符过滤 |
| | HITL 检测 | ✅ | 模式丰富 |
| | 文本缓冲 | ✅ | 通过 debounce 实现 |

## 二、严重问题 (Must Fix)

### 1. 消息分片未实现
- **位置**: `src/channel/dingtalk.js` - `doSend()` / `sendToDingTalk()`
- **问题**: 没有任何分片逻辑。当 Claude 输出超长文本时，钉钉 API 会直接截断或报错
- **设计要求**: 超过 2000 字节时按 1950 字节分片，带 `[1/N]` 序号，片间 50 字节重叠

### 2. ActionCard 未真正实现
- **位置**: `src/channel/dingtalk.js:381-384`
- **问题**: `sendActionCard()` 只是发送了一条纯文本，而不是真正的钉钉交互式 ActionCard
- **影响**: 用户需要手动输入 y/n，但 HITL 激活后用户输入 y/n 会被当作普通文本处理

### 3. HITL 状态下用户回复处理逻辑断裂
- **位置**: `src/index.js:134-145`
- **问题**: `handleChannelText` 没有检查 `this.hitlActive` 状态。HITL 激活后用户发 'y' 会被当作普通文本写入 PTY，而不会触发 `handleApprove()`
- **结果**: HITL 审批流程完全不可用

### 4. ESM 中使用 require()
- **位置**: `src/pty/engine.js:106`, `src/channel/dingtalk.js:354`
- **问题**: 项目是 ESM (`"type": "module"`)，但代码中使用 `require('fs')`，运行时会报错

## 三、中等问题 (Should Fix)

### 5. 白名单路径前缀绕过风险
- **位置**: `src/pty/engine.js:100`
- **问题**: `resolvedPath.startsWith(rootDir)` 存在漏洞。若 `rootDir = '/Users/xxx/project'`，路径 `/Users/xxx/project-hack` 也会通过检查
- **修复**: 应改为 `resolvedPath === rootDir || resolvedPath.startsWith(rootDir + '/')`

### 6. access_token 无缓存
- **位置**: `src/channel/dingtalk.js:208-210`
- **问题**: 每次发送消息都请求一次 access_token，高频输出场景下会大量重复调用，可能触发限流
- **建议**: 缓存 token，钉钉 token 有效期 2 小时

### 7. 启动消息 API 不正确
- **位置**: `src/channel/dingtalk.js:311-319`
- **问题**: `sendStartupMessage` 使用了 `https://oapi.dingtalk.com/robot/send` 接口，这不是正确的个人消息推送 API
- **建议**: 应复用 `batchSend()` 方法

### 8. 欢迎消息未列出子目录
- **位置**: `src/channel/dingtalk.js:331-347`
- **问题**: 设计文档要求欢迎消息包含根目录下的子目录列表，但当前只列出了根目录本身

### 9. claude 路径硬编码
- **位置**: `src/pty/envBuild.js:41`
- **问题**: `/usr/local/bin/claude` 硬编码，不同安装方式路径不同
- **建议**: 使用 `which claude` 动态查找

## 四、小问题 (Nice to Fix)

### 10. logger.js sensitiveKeys 重复
- **位置**: `src/utils/logger.js:4`
- `'clientSecret'` 出现了两次

### 11. 未使用的 import
- **位置**: `src/channel/dingtalk.js:1`
- `import { Readable } from 'stream'` 从未使用

### 12. 调试日志残留
- **位置**: `src/channel/dingtalk.js:63-65`, `src/channel/dingtalk.js:122-124`
- `console.log` 输出完整的消息 JSON，生产环境应移除或降为 debug 级别

### 13. 测试覆盖不足
- 分片测试只测了算法逻辑，没测实际实现（因为实现缺失）
- 缺少 DingTalkChannel 和 PTYEngine 的独立单元测试
