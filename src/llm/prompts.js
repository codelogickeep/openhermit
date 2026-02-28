/**
 * LLM Prompt 模板
 * 用于意图解析、输出格式化、选择检测等场景
 */

export const Prompts = {
  /**
   * 意图解析 Prompt
   * 将用户自然语言转换为结构化意图
   */
  parseIntent: `你是一个命令解析助手。分析用户消息，判断其意图并返回 JSON 格式结果。

## 意图类型
- claude_command: 需要启动 Claude Code 执行的开发任务（写代码、分析、重构等）
- shell_command: 直接执行的 shell 命令（ls、cat、grep 等）
- built_in: 内置命令（/cd、/ls、/restart）
- conversation: 对话交互（选择选项、回复确认、普通对话）

## 输出格式
返回 JSON：{"type": "<意图类型>", "command": "<具体命令>", "params": {}, "confidence": 0.0-1.0}

## 示例
用户: "帮我分析一下这个项目的代码结构"
返回: {"type": "claude_command", "command": "分析项目的代码结构", "params": {}, "confidence": 0.95}

用户: "ls -la"
返回: {"type": "shell_command", "command": "ls -la", "params": {}, "confidence": 0.99}

用户: "/cd myproject"
返回: {"type": "built_in", "command": "/cd", "params": {"path": "myproject"}, "confidence": 1.0}

用户: "2" 或 "选第二个"
返回: {"type": "conversation", "command": "select", "params": {"choice": 2}, "confidence": 0.9}

用户消息: {{userMessage}}

请分析并返回 JSON：`,

  /**
   * 输出格式化 Prompt
   * 将终端输出转换为 Markdown 格式
   */
  formatOutput: `你是一个终端输出格式化助手。将终端输出转换为适合在钉钉中显示的 Markdown 格式。

## 转换规则
1. 代码块用 \`\`\` 包裹，尝试识别语言
2. 表格转换为 Markdown 表格格式
3. 列表用 - 或 1. 格式
4. 标题用 # ## ### 格式
5. 重要信息用 **粗体** 或 ` + '`' + `代码` + '`' + ` 标记
6. 错误信息前加 ❌
7. 成功信息前加 ✅
8. 警告信息前加 ⚠️
9. 去除 ANSI 颜色码和控制字符
10. 压缩多余空行（最多保留 2 行）

## 输出要求
- 保持信息的完整性
- 适合移动端阅读
- 控制总长度，过长时合理截断

终端输出:
{{terminalOutput}}

请转换为 Markdown：`,

  /**
   * 选择提示解析 Prompt
   * 从终端输出中提取选项列表
   */
  parseSelection: `你是一个选择提示解析助手。从终端输出中识别用户需要做出的选择。

## 任务
1. 判断是否存在需要用户选择的提示
2. 如果存在，提取所有选项
3. 识别默认选项（如果有）
4. 判断选择方式（数字选择、y/n 确认、文本输入等）

## 输出格式
返回 JSON：
{
  "hasSelection": true/false,
  "options": [{"index": 1, "text": "选项文本", "isDefault": false}],
  "promptText": "提示文本",
  "selectType": "number|confirm|text",
  "context": "选择场景描述"
}

## 示例
终端输出: "请选择:\n1. 创建新文件\n2. 修改现有文件\n3. 删除文件"
返回: {"hasSelection": true, "options": [{"index": 1, "text": "创建新文件", "isDefault": false}, ...], "selectType": "number", ...}

终端输出:
{{terminalOutput}}

请分析并返回 JSON：`,

  /**
   * 用户选择映射 Prompt
   * 将用户的自然语言选择转换为 PTY 输入
   */
  mapSelection: `你是一个选择映射助手。将用户的自然语言选择转换为终端输入。

## 任务
根据选项列表，将用户的选择转换为正确的输入。

## 输出格式
返回 JSON：{"input": "<终端输入>", "method": "number|arrow|text"}

## 选择方式
- 数字选择：直接输入数字或选项文本
- 方向键选择：需要转换为箭头键（↑↓）和回车
- y/n 确认：输入 y 或 n

## 示例
选项: [{"index": 1, "text": "创建新文件"}, {"index": 2, "text": "修改现有文件"}]
用户输入: "第二个" 或 "2" 或 "修改"
返回: {"input": "2", "method": "number"}

当前选项: {{options}}
用户输入: {{userInput}}

请分析并返回 JSON：`
};

export default Prompts;
