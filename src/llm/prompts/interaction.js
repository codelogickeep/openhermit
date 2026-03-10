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
  "selectionType": "arrow | number | confirm",
  "defaultOptionIndex": 1,
  "taskCompleted": true/false,
  "context": {
    "question": "Claude 正在问用户什么问题？（简洁明了，不超过100字）",
    "options": ["选项1", "选项2", ...],
    "additionalInfo": "其他有用的上下文信息（可选）"
  }
}

## 重要：识别选择类型

1. **方向键选择模式 (arrow)**：终端输出中有以下标记之一：
   - ❯ 或 → 标记当前高亮的选项（光标所在位置）
   - ✔ 或 ✓ 标记已被选中的选项
   - 例如：\`❯ 1. Dark mode ✔\` 表示第1个选项被高亮且选中

2. **数字选择模式 (number)**：选项只是简单的数字列表，没有选中标记
   - 例如：1. 创建新文件\n2. 修改现有文件

3. **确认模式 (confirm)**：y/n 确认
   - 例如：(y/n) 或 [Y/n]

## 关键：识别 defaultOptionIndex

**defaultOptionIndex** 是当前被高亮/选中的选项的位置（从1开始）。

**识别方法**：
1. 找到有 \`❯\` 或 \`→\` 标记的那一行
2. 提取该行的数字（如 \`1.\` 中的 1）
3. 该数字就是 defaultOptionIndex

**示例**：
\`\`\`
❯ 1. Dark mode ✔
  2. Light mode
  3. Dark mode (colorblind-friendly)
\`\`\`
- 有 \`❯\` 的行是 \`❯ 1. Dark mode ✔\`
- 该行的数字是 1
- 所以 **defaultOptionIndex = 1**

**错误示例（不要这样）**：
- ❌ 看到 \`✔\` 就认为是默认选项
- ❌ 把选项内容当作索引

判断标准：
1. needsInteraction: 如果 Claude 正在等待用户输入，设为 true
2. taskCompleted: 如果终端显示 "Crunched for XXs" 或 "Brewed for XXs" 或任务已明确完成，设为 true
3. type:
   - selection: 有编号选项列表供用户选择
   - text_input: 需要用户输入自由文本
   - confirmation: y/n 确认
   - none: Claude 正在思考或执行任务，不需要用户输入
4. selectionType: arrow | number | confirm（仅 type 为 selection 或 confirmation 时需要）
5. defaultOptionIndex: 有 ❯ 标记的那一行的数字（仅方向键模式需要）
6. options: 仅当 type 为 selection 时，提取选项列表
7. question: 提取 Claude 正在问的问题
8. 只返回 JSON，不要其他内容`,

  /**
   * 用户回复解析 Prompt
   * 将用户的自然语言选择转换为终端输入
   */
  parseReply: `你是一个用户意图解析助手。

【之前的终端输出】
"""
{{terminalOutput}}
"""

【之前的分析结果】
{{previousAnalysis}}

【用户的回复】
{{userReply}}

请根据**分析结果中的 selectionType** 将用户回复转换为终端输入。

## 关键：根据 selectionType 处理

### 如果 selectionType === "arrow"（方向键选择模式）

**必须计算 arrowCount**：
1. 从终端输出中找到默认选中的选项（有 ❯、→、✔ 等标记）
2. 从用户回复中提取想选择的选项数字
3. 计算：arrowCount = 用户想选的选项 - 默认选项位置

**示例**：
终端显示：
\`\`\`
❯ 1. Dark mode ✔
  2. Light mode
  3. Dark mode (colorblind-friendly)
\`\`\`
- 默认选项是第1个（有 ❯ 和 ✔ 标记）
- 用户回复 "2"，想选第2个
- arrowCount = 2 - 1 = 1（需要按1次下箭头）

**返回格式**：
\`\`\`json
{
  "understood": true,
  "selectionType": "arrow",
  "arrowCount": 1,
  "targetOption": 2,
  "feedback": "已选择 Light mode"
}
\`\`\`

### 如果 selectionType === "number"（数字选择模式）
- 直接输入用户选择的数字
- 返回：{ "selectionType": "number", "input": "2" }

### 如果 selectionType === "confirm"（确认模式）
- y/yes/是/同意 → input: "y"
- n/no/否/拒绝 → input: "n"
- 返回：{ "selectionType": "confirm", "input": "y" }

## 重要提示
1. 方向键模式**必须返回 arrowCount**，不要返回 input
2. arrowCount = 目标选项位置 - 默认选项位置
3. 只返回 JSON，不要其他内容`,

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
