## ADDED Requirements

### Requirement: PTY 进程启动
系统 MUST 使用适当的环境启动伪终端进程。

#### Scenario: PTY 启动
- **当** 应用启动时
- **则** shell 进程以继承的环境变量启动

### Requirement: 环境变量注入
系统 MUST 将环境变量注入 PTY 进程。

#### Scenario: 继承主机环境
- **当** PTY 启动时
- **则** host 的 process.env 被传递给子进程

#### Scenario: 配置 API 代理
- **当** .env 中设置了 ANTHROPIC_API_KEY 和 ANTHROPIC_BASE_URL
- **则** 这些变量覆盖继承的变量

### Requirement: 输入输出流
系统 MUST 处理双向数据流。

#### Scenario: 写入 PTY
- **当** 通道收到文本消息时
- **则** 数据被写入 PTY stdin

#### Scenario: 从 PTY 读取
- **当** PTY 输出数据时
- **则** 数据被发送到净化器

### Requirement: 进程生命周期
系统 MUST 管理 PTY 进程生命周期。

#### Scenario: 进程退出
- **当** PTY 进程意外退出时
- **则** 发出退出事件以便处理重启

### Requirement: 工作目录白名单
系统 MUST 只允许在配置的工作目录（ALLOWED_ROOT_DIR）下操作。

#### Scenario: 目录在白名单内
- **当** 收到 `/cd /allowed/path` 且路径在 ALLOWED_ROOT_DIR 子目录下
- **则** 切换到指定目录

#### Scenario: 目录在白名单外
- **当** 收到 `/cd /forbidden/path` 且路径不在 ALLOWED_ROOT_DIR 子目录下
- **则** 拒绝切换并返回错误信息 "仅允许在 {ALLOWED_ROOT_DIR} 下操作"

#### Scenario: 未配置白名单
- **当** 未设置 ALLOWED_ROOT_DIR 环境变量
- **则** 拒绝启动应用，提示必须配置工作目录白名单
