## ADDED Requirements

### Requirement: ANSI 码剥离
系统 MUST 从终端输出中移除 ANSI 转义码。

#### Scenario: 颜色码被剥离
- **当** PTY 输出包含 ANSI 颜色码时
- **则** 颜色码被移除，保留纯文本

#### Scenario: 控制字符被移除
- **当** PTY 输出包含 \b、\r、\n 时
- **则** 它们被适当过滤

### Requirement: 加载动画过滤
系统 MUST 过滤转圈动画和加载指示器。

#### Scenario: 转圈器被移除
- **当** 输出包含重复的转圈字符时
- **则** 它们被过滤以减少噪音

### Requirement: HITL 检测
系统 MUST 检测人在回路的审批提示。

#### Scenario: 是否提示被检测到
- **当** 输出包含 `(y/n)`、`(Y/N)`、`(yes/no)` 等模式时
- **则** 触发 HITL 并暂停输出

#### Scenario: 允许提示被检测到
- **当** 输出包含 `Allow`、`Continue`、`Proceed` 时
- **则** 触发 HITL 并暂停输出

### Requirement: 文本缓冲
系统 MUST 为防抖发送缓冲输出。

#### Scenario: 文本被缓冲
- **当** 多个数据块快速连续到达时
- **则** 它们被拼接以便批量发送
