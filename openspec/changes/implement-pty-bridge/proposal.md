# 变更：从零实现 PTY 桥接服务

## 变更原因
OpenHermit 是一个新项目，目前仅有架构和 PRD 文档。核心功能需要从零开始实现，以支持通过钉钉进行远程 PTY 访问。

## 变更内容
- 创建钉钉 Stream SDK 集成的通道网关
- 实现基于 node-pty 的 PTY 引擎，支持环境变量注入
- 构建终端流净化器，用于去除 ANSI 码和加载动画
- 添加 HITL（人在回路）拦截器，用于检测危险命令
- 设置项目基础设施（package.json、vitest、dotenv）

## 影响范围
- 涉及的规格：channel-gateway（通道网关）、pty-bridge（PTY 桥接）、stream-purifier（流净化器）
- 创建 src/ 下的完整项目结构

## 验收标准
1. **功能验收**：
   - 应用启动后能成功连接钉钉 WebSocket
   - 钉钉发送的文本能正确注入 PTY
   - PTY 输出能正确发送到钉钉（经过净化和分片）
   - 内置命令 `/cd` 和 `/restart` 能正常工作
   - HITL 检测到 `(y/n)` 等提示时会暂停输出并发送审批卡片
   - 用户审批后响应能正确写入 PTY

2. **测试验收**：
   - 所有 vitest 单元测试通过
   - envBuild.js、stripper.js、hitl.js 均有测试覆盖

3. **运行验收**：
   - `npm install` 无错误
   - `npm start` 能正常启动
   - `npm test` 测试通过
