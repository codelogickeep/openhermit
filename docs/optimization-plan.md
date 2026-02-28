# OpenHermit 优化执行计划

> 创建日期: 2026-02-28
> 基于: code-review-report.md

## 执行计划

按优先级排列，逐步执行：

### P0 - 必须修复（功能不可用）

| # | 任务 | 复杂度 | 涉及文件 | 状态 |
|---|------|--------|----------|------|
| 1 | 修复 ESM require() 问题 | 低 | engine.js, dingtalk.js | ✅ 已完成 |
| 2 | 修复 HITL 审批流程（文本 y/n 回复） | 中 | index.js | ✅ 已完成 |
| 3 | 实现消息分片功能 | 中 | dingtalk.js | ✅ 已完成 |
| 4 | 修复白名单路径检查漏洞 | 低 | engine.js | ✅ 已完成 |

### P1 - 应该修复（功能有缺陷）

| # | 任务 | 复杂度 | 涉及文件 | 状态 |
|---|------|--------|----------|------|
| 5 | access_token 缓存 | 低 | dingtalk.js | ✅ 已完成 |
| 6 | 修复 sendStartupMessage API | 低 | dingtalk.js | ✅ 已完成 |
| 7 | 完善欢迎消息子目录列表 | 低 | dingtalk.js | ✅ 已完成 |

### P2 - 可以修复（代码质量）

| # | 任务 | 复杂度 | 涉及文件 | 状态 |
|---|------|--------|----------|------|
| 8 | claude 路径动态查找 | 低 | envBuild.js | ✅ 已完成 |
| 9 | 清理调试日志 + 重复 key + 无用 import | 低 | dingtalk.js, logger.js | ✅ 已完成 |

### P3 - 后续完善

| # | 任务 | 复杂度 | 涉及文件 | 状态 |
|---|------|--------|----------|------|
| 10 | 实现真正的钉钉 ActionCard + 回调 | 高 | dingtalk.js | ⬜ 跳过（太复杂，需用户配置） |
| 11 | 补充单元测试（分片、Channel） | 高 | tests/ | ✅ 已完成 |

## 验证结果

- `npm test`: 78 tests passed (6 test files)
- 无回归问题

## 变更摘要

### engine.js
- 添加 `import fs from 'fs'`，移除运行时 `require('fs')`
- 白名单检查改为 `resolvedPath === rootDir || resolvedPath.startsWith(rootDir + '/')`

### dingtalk.js
- `import { Readable }` → `import fs from 'fs'`，移除未使用导入 + 修复运行时 require
- 新增 `getAccessToken()` 方法，缓存 token 110 分钟
- 新增 `splitChunks()` 方法，实现消息分片（>2000字节按1950分片，50字节重叠）
- `sendStartupMessage()` 改为复用 `batchSend()` API
- `sendWelcome()` 改为列出根目录下的实际子目录
- 调试 console.log 改为 logger.debug

### index.js
- `handleChannelText()` 增加 HITL 状态判断，支持 y/yes/n/no 文本回复触发审批

### envBuild.js
- `getDefaultShell()` 改为 `which claude` 动态查找

### logger.js
- 移除 sensitiveKeys 中重复的 `clientSecret`

### dingtalk.js (P3 补充)
- 修复 `splitChunks()` 方法：改用字节计算分片边界，正确处理中文和 emoji 等多字节字符

### tests/ (P3 新增)
- 新增 `dingtalk-channel.test.js`：21 个测试用例
  - splitChunks 分片逻辑（短文本、长文本、中文、emoji、混合字符）
  - send 方法（buffer 管理）
  - isConnected/isMockMode 状态
  - sendActionCard 审批消息
  - getAccessToken 缓存
  - 边界情况处理
