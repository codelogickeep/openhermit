/**
 * 交互检测 Prompt
 * 用于分析终端输出中的交互需求，解析用户回复
 */

export const InteractionPrompts = {
  /**
   * 终端输出分析 Prompt
   * 判断是否需要用户交互
   */
  analyzeOutput: `你是一个终端交互分析助手。分析以下 Claude Code 终端输出，判断当前状态。

【终端输出】
"""
{{terminalOutput}}
"""

请返回 JSON 格式：
{
  "needsInteraction": true/false,
  "type": "selection | text_input | confirmation | none",
  "taskCompleted": true/false,
  "context": {
    "question": "Claude 正在问用户什么问题？（简洁明了，不超过100字）",
    "options": ["选项1", "选项2", ...],
    "additionalInfo": "其他有用的上下文信息（可选）"
  }
}

判断标准：
1. needsInteraction: 如果 Claude 正在等待用户输入，设为 true
2. taskCompleted: 如果终端显示 "Crunched for XXs" 或 "Brewed for XXs" 或任务已明确完成，设为 true
3. type:
   - selection: 有编号选项列表供用户选择
   - text_input: 需要用户输入自由文本
   - confirmation: y/n 确认
   - none: Claude 正在思考或执行任务，不需要用户输入
4. options: 仅当 type 为 selection 时，提取选项列表
5. question: 提取 Claude 正在问的问题
6. 只返回 JSON，不要其他内容`,

  /**
   * 用户回复解析 Prompt
   * 将用户的自然语言选择转换为终端输入
   */
  parseReply: `你是一个用户意图解析助手。

【之前的终端输出】
"""
{{terminalOutput}}
"""

【分析的问题】
{{previousAnalysis}}

【用户的回复】
{{userReply}}

请将用户回复转换为终端输入。

返回 JSON 格式：
{
  "understood": true,
  "input": "要发送到终端的具体内容",
  "feedback": "给用户的简短反馈（可选）"
}

要求：
1. 如果用户回复数字，原样保留
2. 如果用户回复文本描述，转换为合适的输入
3. 模糊回复时，根据上下文推断
4. 只返回 JSON`,

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

export default InteractionPrompts;
