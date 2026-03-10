/**
 * 交互检测 Prompt
 * 用于分析终端输出中的交互需求，解析用户回复
 */

export const InteractionPrompts = {
  /**
   * 终端输出分析 Prompt
   * 判断是否需要用户交互
   */
  analyzeOutput: `你是一个终端交互分析助手。分析以下 Claude Code 终端输出,判断当前状态。

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

## 重要:识别选择类型

1. **方向键选择模式 (arrow)**：终端输出中有以下标记之一：
   - ❯ 或 → 标记当前高亮的选项（光标所在位置）
   - ✔ 或 ✓ 标记已被选中的选项

2. **数字选择模式 (number)**：选项只是简单的数字列表，没有选中标记

3. **确认模式 (confirm)**：y/n 确认

## 关键:识别 defaultOptionIndex

**defaultOptionIndex** 是当前被 ❯ 或 → 标记的选项的**序号**（从1开始）。

**识别方法**（非常重要！）:
1. 找到以 \`❯\` 或 \`→\` **开头**的那一行
2. 该行中的**第一个数字**就是 defaultOptionIndex
3. **不要看 ✔ 在哪一行，只看 ❯ 在哪一行**

**示例分析**：
\`\`\`
❯ 1. Dark mode ✔
  2. Light mode
\`\`\`
- \`❯\` 在第1行开头
- 该行的数字是 \`1\`
- 所以 **defaultOptionIndex = 1**（不是2！）

\`\`\`
  1. Dark mode
❯ 2. Light mode ✔
\`\`\`
- \`❯\` 在第2行开头
- 该行的数字是 \`2\`
- 所以 **defaultOptionIndex = 2**

**常见错误（不要这样）**：
- ❌ 看到 \`✔\` 在第2行就认为 defaultOptionIndex=2
- ❌ 没有找到 ❯ 就随便选一个数字
- ❌ 把选项文本当作索引

判断标准：
1. needsInteraction: 如果 Claude 正在等待用户输入，设为 true
2. taskCompleted: 如果终端显示 "Crunched for XXs" 或 "Brewed for XXs" 或任务已明确完成，设为 true
3. type: selection/text_input/confirmation/none
4. selectionType: arrow/number/confirm（仅 type 为 selection 或 confirmation 时需要）
5. defaultOptionIndex: **有 ❯ 开头的那一行的数字**（仅方向键模式需要）
6. options: 提取所有选项文本
7. question: 提取问题
8. 只返回 JSON`,

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

**步骤1：从终端输出中识别默认选项位置**
- 找到有 \`❯\` 或 \`→\` 标记的行
- 提取该行的数字，这就是 \`defaultOptionIndex\`
- 例如：\`❯ 1. Dark mode ✔\` → defaultOptionIndex = 1

**步骤2：识别用户想选的选项**
- 从用户回复中提取数字
- 例如：用户回复 "2" → targetOption = 2

**步骤3：计算 arrowCount**
- arrowCount = targetOption - defaultOptionIndex
- 例如：targetOption = 2, defaultOptionIndex = 1 → arrowCount = 1

**返回格式**：
\`\`\`json
{
  "understood": true,
  "selectionType": "arrow",
  "defaultOptionIndex": 1,
  "targetOption": 2,
  "arrowCount": 1,
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
1. **必须从终端输出中识别 defaultOptionIndex**，不要依赖 previousAnalysis 中的值
2. arrowCount = targetOption - defaultOptionIndex
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
