## ADDED Requirements

### Requirement: 钉钉 Stream 连接
系统 MUST 使用 Stream SDK 建立与钉钉的持久 WebSocket 连接。

#### Scenario: 连接建立
- **当** 应用使用有效的 AppKey 和 AppSecret 启动时
- **则** WebSocket 连接建立并维持心跳

#### Scenario: 连接断开
- **当** WebSocket 意外断开时
- **则** 自动尝试重连

### Requirement: 入站消息处理
系统 MUST 接收来自钉钉的文本消息并转发到 PTY。

#### Scenario: 收到文本消息
- **当** 用户通过钉钉发送文本时
- **则** 消息被转发到 PTY stdin

#### Scenario: 内置命令 /ls（查看目录）
- **当** 用户发送 `/ls`
- **则** 返回当前工作目录和白名单下的可选目录列表

#### Scenario: 内置命令 /cd（在白名单内）
- **当** 用户发送 `/cd /allowed/path` 且路径在 ALLOWED_ROOT_DIR 子目录下
- **则** PTY 工作目录被切换到指定路径

#### Scenario: 内置命令 /cd（在白名单外）
- **当** 用户发送 `/cd /forbidden/path` 且路径不在 ALLOWED_ROOT_DIR 子目录下
- **则** 返回错误信息，不切换目录

#### Scenario: 内置命令 /restart
- **当** 用户发送 `/restart`
- **则** PTY 进程被终止并重新启动

### Requirement: 欢迎消息
系统 MUST 在用户首次连接时发送包含白名单目录的欢迎消息。

#### Scenario: 用户首次连接
- **当** 用户首次建立连接时
- **则** 自动发送欢迎消息，包含当前目录和可选目录列表

### Requirement: 出站消息发送
系统 MUST 以防抖方式向钉钉发送文本消息。

#### Scenario: 防抖发送
- **当** 多个 PTY 输出在 1500ms 内到达时
- **则** 它们被合并为单条消息发送

### Requirement: 消息分片
系统 MUST 对超长消息进行分片发送。

#### Scenario: 消息超长
- **当** 待发送文本超过 2000 字节时
- **则** 自动分片，每片带序号 `[1/N]`，片与片间保留 50 字节重叠

#### Scenario: 分片发送
- **当** 需要分 3 片发送时
- **则** 依次发送 `[1/3]...`、`[2/3]...`、`[3/3]...`

### Requirement: 审批 ActionCard
系统 MUST 为 HITL 审批请求发送交互式卡片。

#### Scenario: 审批卡片发送
- **当** 检测到危险命令时
- **则** 发送带有同意/拒绝按钮的 ActionCard

#### Scenario: 按钮回调接收
- **当** 用户点击同意或拒绝按钮时
- **则** 对应的响应（y/n）被写入 PTY
