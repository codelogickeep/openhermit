## 背景
OpenHermit 第一阶段：通过钉钉实现本地 Claude Code 的远程访问，无需公网 IP。

## 目标 / 非目标
- 目标：实现钉钉与本地 PTY 之间的双向通信
- 目标：过滤终端噪音（ANSI、加载动画）
- 目标：通过人工审批阻止危险命令
- 非目标：不支持多会话（仅支持单用户）
- 非目标：不支持微信/Telegram 集成
- 非目标：不支持自定义 shell（仅支持 claude 和 bash）

## 技术决策
- **Shell**：默认为 `claude`，降级使用 `bash`
- **环境**：继承 host 进程环境变量，若提供则注入 ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL
- **防抖**：1500ms 窗口用于消息批处理
- **HITL 模式**：匹配 `(y/n)`、`(Y/N)``、`Allow`、`Continue`
- **消息分片**：钉钉文本消息限制 2048 字节，超过则分片发送，每片带序号 ` [1/N]`

## 安全策略

### 工作目录白名单
- 系统启动时只能在一个允许的根目录（ALLOWED_ROOT_DIR）下工作
- `/cd` 命令只能切换到白名单目录下的子目录
- 尝试切换到白名单外目录时，拒绝并提示错误

### 白名单目录展示
- 用户首次连接时，自动推送白名单目录列表
- 可通过 `/ls` 命令随时查看可用的工作目录
- 显示当前工作目录和可选的子目录

### 配置
```bash
# .env 配置
ALLOWED_ROOT_DIR=/Users/xxx/projects  # 允许的工作目录根路径
```

### 验证逻辑
```
用户发送 /cd /path/to/dir
      │
      ▼
检查路径是否为 ALLOWED_ROOT_DIR 的子目录?
      │
      ├─► 是 ──► 切换目录
      │
      └─► 否 ──► 拒绝并返回错误: "仅允许在 {ALLOWED_ROOT_DIR} 下操作"
```

## 架构

```
[钉钉] <--WebSocket--> [通道] <--> [净化器] <--> [PTY] <--> [Claude]
                            |                 |
                         命令              检测到 HITL?
                            |                   |
                            v                   v
                       [PTY 输入]      [ActionCard] --> [用户审批] --> [PTY]
                            │
                      [目录安全检查]
```

## 消息处理流程

### 用户在钉钉发送消息时的处理逻辑

```
用户发送消息
      │
      ▼
┌─────────────────┐
│ 判断消息类型     │
└─────────────────┘
      │
      ├─► /ls        ──► 显示白名单目录和当前目录
      │
      ├─► /cd /path  ──► 检查白名单 ──► 切换 PTY 工作目录
      │
      ├─► /restart   ──► 重启 PTY 进程
      │
      └─► 普通文本   ──► 写入 PTY stdin
```

### 启动 Claude Code 开发的具体流程

1. **首次连接**：
   - 系统发送欢迎消息，包含白名单目录列表
   - 提示用户使用 `/cd` 切换目录

2. **用户操作**：
   - 用户发送 `/ls` 查看可用目录
   - 用户发送 `/cd my-project` 切换到项目目录
   - 用户发送 `claude` 启动 Claude Code

3. **持续对话**：
   - 用户发送具体开发需求
   - Claude Code 响应输出到钉钉

## 关键接口

### PTY 引擎
```js
class PTYEngine {
  start()              // 启动 shell 进程
  write(data)          // 写入 stdin
  onData(callback)     // 注册 stdout 监听器
  restart()            // 终止并重新启动
  getWorkingDir()      // 获取当前目录
  setWorkingDir(path)  // 切换工作目录（带白名单检查）
}
```

### 通道网关
```js
class DingTalkChannel {
  connect()         // 建立 WebSocket
  onMessage(cb)    // 处理入站消息
  send(text)        // 推送文本到钉钉（自动分片）
  sendActionCard()  // 推送审批卡片
  sendWelcome()     // 发送欢迎消息（包含白名单目录）
  sendDirList()     // 发送目录列表
}
```

### 流净化器
```js
class StreamPurifier {
  process(data)    // 去除 ANSI、过滤噪音
  checkHitl(text) // 检测审批提示
}
```

## 消息分片策略

当输出文本超过 2048 字节时：

1. **分片规则**：
   - 每片最大 2000 字节（预留序号空间）
   - 保留最后 50 字节用于重叠（避免单词被截断）
   - 格式：`[1/3] 第一片内容...`
   - 格式：`[2/3] ...重叠部分第二片内容...`
   - 格式：`[3/3] 最后一片内容`

2. **分片算法**：
   ```
   如果 text.length > 2000:
     计算需要分片数 n = ceil(text.length / 1950)
     对每片 i (0 到 n-1):
       start = i * 1950
       end = min(start + 1950, text.length)
       如果 i > 0: start -= 50 (重叠)
       content = text.slice(start, end)
       发送 "[{i+1}/{n}] " + content
   ```

3. **防抖与分片结合**：
   - 先缓冲 1500ms
   - 缓冲完成后检查总长度
   - 如需分片，立即发送所有分片（不分片等待）

## 欢迎消息格式

用户首次连接时，系统自动推送：

```
🦀 欢迎使用 OpenHermit

当前工作目录: /Users/xxx/projects
可选目录:
  - /Users/xxx/projects/project-a
  - /Users/xxx/projects/project-b

命令:
  /cd <目录>  切换工作目录
  /ls         查看可选目录
  /restart    重启 Claude Code
  claude      启动 Claude Code

请先使用 /cd 切换到项目目录，然后输入 claude 启动。
```

## 风险与权衡
- **风险**：node-pty 在 macOS 上的原生编译 → 解决方案：使用预编译二进制
- **风险**：钉钉限流 → 解决方案：1.5s 防抖窗口 + 分片时立即发送
