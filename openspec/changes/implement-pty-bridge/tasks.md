## 1. 项目基础设施
- [ ] 1.1 创建 package.json，包含依赖：node-pty、dingtalk-stream-sdk-nodejs、strip-ansi、lodash.debounce、dotenv、pino、vitest
- [ ] 1.2 创建 .env.example 模板（包含 ALLOWED_ROOT_DIR 配置）
- [ ] 1.3 创建 src/index.js 入口文件
- [ ] 1.4 执行 npm install

## 2. 配置层
- [ ] 2.1 创建 src/config/index.js 用于加载 .env
- [ ] 2.2 验证必需的环境变量（AppKey、AppSecret、ALLOWED_ROOT_DIR）

## 3. PTY 引擎
- [ ] 3.1 创建 src/pty/envBuild.js 用于组装环境变量
- [ ] 3.2 创建 src/pty/engine.js 作为 node-pty 的封装
- [ ] 3.3 实现带环境注入的 shell 启动
- [ ] 3.4 添加内置命令处理器（/cd、/restart、/ls）
- [ ] 3.5 实现工作目录白名单检查（ALLOWED_ROOT_DIR）

## 4. 通道网关（钉钉）
- [ ] 4.1 创建 src/channel/dingtalk.js
- [ ] 4.2 实现与钉钉 Stream SDK 的 WebSocket 连接
- [ ] 4.3 处理接收到的文本消息
- [ ] 4.4 实现带防抖的 outbound 消息发送
- [ ] 4.5 实现消息分片功能（超过 2048 字节）
- [ ] 4.6 实现欢迎消息功能（首次连接时发送白名单目录）
- [ ] 4.7 实现 /ls 命令（查看可选目录）

## 5. 流净化器
- [ ] 5.1 创建 src/purifier/stripper.js 用于去除 ANSI
- [ ] 5.2 创建 src/purifier/hitl.js 用于人在回路检测
- [ ] 5.3 实现 (y/n) 模式匹配
- [ ] 5.4 创建用于审批的 ActionCard 生成逻辑

## 6. 集成
- [ ] 6.1 将 PTY 输出通过净化器连接到钉钉
- [ ] 6.2 将钉钉消息连接到 PTY 输入
- [ ] 6.3 实现 HITL 暂停/恢复流程
- [ ] 6.4 将分片功能与净化器集成

## 7. 日志
- [ ] 7.1 使用 pino 创建 src/utils/logger.js
- [ ] 7.2 在各处添加结构化日志

## 8. 测试
- [ ] 8.1 为 envBuild.js 编写单元测试
- [ ] 8.2 为 stripper.js 编写单元测试
- [ ] 8.3 为 hitl.js 编写单元测试
