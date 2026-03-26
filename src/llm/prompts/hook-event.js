/**
 * Hook Event Prompts
 * 用于解析 Hook 事件和用户回复
 */

export const HookEventPrompts = {
  /**
   * Stop 事件交互判断 Prompt
   * 判断任务完成后是否需要等待用户输入
   */
  analyzeStopEvent: `你是一个 Claude Code 任务状态分析助手。分析任务完成后的最后一条消息，判断是否需要等待用户交互。

【Claude 最后一条消息】
"""
{{lastMessage}}
"""

## 判断标准

### 需要用户交互 (needsUserInput: true)
1. **等待选择**：消息中包含选项列表（1. 2. 3. 或 A. B. C.）
2. **等待确认**：消息以问号结尾，或包含"请选择"、"请确认"、"请输入"
3. **等待反馈**：消息明确表示"等待您的回复"或类似表述
4. **未完成任务**：消息表示任务未完成，需要用户进一步操作

### 不需要用户交互 (needsUserInput: false)
1. **任务已完成**：消息明确表示任务完成，如"完成"、"已推送"、"成功"等
2. **纯信息输出**：消息只是展示结果、代码、文件内容等
3. **无后续操作**：没有明显的等待用户输入的迹象
4. **Markdown 表格/代码块**：单纯的代码或数据展示

## 注意事项
- 不要被 Markdown 表格中的版本号误判为选项列表
- 代码块中的数字（如行号）不是选项
- 如果消息只是展示执行结果，通常不需要交互
- 如果消息末尾是问号但只是反问/确认，不是真的等待输入，则不需要交互

请返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "needsUserInput": true/false,
  "reason": "简要说明判断理由（不超过30字）"
}`,

  /**
   * PreToolUse 事件解析 Prompt
   * 将工具调用转换为用户友好的确认消息
   */
  preToolUse: `你是一个 Claude Code 操作分析助手。分析以下工具调用请求，生成用户友好的确认消息。

【工具名称】
{{toolName}}

【工具参数】
{{toolInput}}

请返回 JSON 格式：
{
  "title": "操作标题（简洁，不超过 20 字）",
  "description": "操作描述（清晰说明要做什么，不超过 100 字）",
  "risk": "low/medium/high",
  "suggestion": "给用户的建议（可选）"
}

风险判断标准：
- low: 读取文件、搜索等安全操作
- medium: 编辑文件、执行普通命令
- high: 删除文件、执行危险命令（rm -rf、sudo 等）

只返回 JSON，不要其他内容。`,

  /**
   * Notification 事件解析 Prompt
   * 分析通知类型
   */
  notification: `你是一个 Claude Code 通知分析助手。分析以下通知，判断其类型。

【通知数据】
{{notification}}

请返回 JSON 格式：
{
  "type": "idle/permission/info",
  "message": "给用户的简短提示",
  "needsAction": true/false
}

类型判断：
- idle: Claude 正在等待用户输入
- permission: Claude 需要权限确认
- info: 普通信息通知

只返回 JSON。`,

  /**
   * 用户回复解析 Prompt
   * 结合 Hook 上下文解析用户回复
   */
  userReply: `你是一个用户意图解析助手。根据上下文，将用户的回复转换为 Claude Code 需要的输入。

【当前上下文】
{{context}}

【用户回复】
{{userReply}}

请返回 JSON 格式：
{
  "input": "要发送到 Claude Code 的具体内容",
  "feedback": "给用户的简短反馈（可选）"
}

转换规则：
1. 如果用户确认（y/yes/确认/同意），返回 "y"
2. 如果用户拒绝（n/no/拒绝/取消），返回 "n"
3. 如果用户选择数字，原样返回数字
4. 如果用户提供具体指令，转换为合适的输入
5. 对于模糊回复，根据上下文推断

只返回 JSON。`
};

export default HookEventPrompts;
