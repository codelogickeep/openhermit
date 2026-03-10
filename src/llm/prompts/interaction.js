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
- 该行的数字是 \`1\`（从 "1. Dark mode" 中提取）
- 所以 **defaultOptionIndex = 1**

**无空格示例**（终端输出可能没有空格）：
\`\`\`
❯1.Darkmode✔
  2.Lightmode
\`\`\`
- \`❯\` 在第1行开头
- 该行的数字是 \`1\`（从 "1.Darkmode" 中提取第一个数字）
- 所以 **defaultOptionIndex = 1**

**另一个示例**：
\`\`\`
  1.Darkmode
❯2.Lightmode✔
\`\`\`
- \`❯\` 在第2行开头
- 该行的数字是 \`2\`（从 "2.Lightmode" 中提取第一个数字）
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
   * 将用户的自然语言选择转换为 PTY 操作步骤
   */
  parseReply: `你是一个 PTY 终端模拟器操作步骤生成器。

## 背景：PTY 终端交互

你正在控制一个 PTY（伪终端）会话。用户通过钉钉远程发送消息，你需要将这些消息转换为 PTY 终端的操作步骤。

**关键概念**：
- PTY 终端是一个**模拟终端**，不能直接"点击"选项
- 选项选择需要通过**键盘操作**完成：方向键移动光标 + 回车确认
- \`❯\` 或 \`→\` 表示当前光标位置（不是已选中的选项）
- \`✔\` 或 \`✓\` 表示推荐或默认选项

【终端输出】
"""
{{terminalOutput}}
"""

【用户回复】
{{userReply}}

请根据终端输出和用户回复，生成 PTY 操作步骤。

## ⚠️ 极其重要：必须从终端输出中提取 defaultOptionIndex

**不要使用之前的分析结果！必须从上面的【终端输出】中重新提取！**

**defaultOptionIndex** 是 \`❯\` 或 \`→\` 所在行的**第一个数字**（从1开始）。

**提取步骤**：
1. 在【终端输出】中找到包含 \`❯\` 或 \`→\` 的行
2. 从该行中提取第一个数字
3. 这个数字就是 defaultOptionIndex（当前光标位置）

**示例1**：
\`\`\`
❯ 1. Dark mode ✔
  2. Light mode
\`\`\`
- \`❯\` 在第1行
- 该行的第一个数字是 \`1\`
- **defaultOptionIndex = 1**（光标在第1个选项）

**示例2（无空格）**：
\`\`\`
❯1.Darkmode✔
  2.Lightmode
\`\`\`
- \`❯\` 在第1行
- 该行的第一个数字是 \`1\`（从 "1.Darkmode" 中提取）
- **defaultOptionIndex = 1**（光标在第1个选项）

**示例3**：
\`\`\`
  1.Darkmode
❯2.Lightmode✔
\`\`\`
- \`❯\` 在第2行
- 该行的第一个数字是 \`2\`（从 "2.Lightmode" 中提取）
- **defaultOptionIndex = 2**（光标在第2个选项）

## PTY 终端选择模式

### 1. 方向键选择模式 (selectionType: "arrow")
**特征**：终端输出中有 \`❯\` 或 \`→\` 标记

**操作原理**：
- 光标当前在 defaultOptionIndex 位置
- 用户想选 targetOption 位置
- 需要按 \`targetOption - defaultOptionIndex\` 次方向键
- 最后按回车确认

**示例**：光标在第1个选项，用户想选第3个
- 需要按 2 次下箭头（3 - 1 = 2）
- 然后按回车

**返回格式**：
\`\`\`json
{
  "selectionType": "arrow",
  "defaultOptionIndex": <从终端输出提取>,
  "targetOption": <用户想选的序号>,
  "steps": [
    { "action": "arrow_down", "count": <targetOption - defaultOptionIndex> },
    { "action": "enter" }
  ],
  "feedback": "已选择第X个选项"
}
\`\`\`

**⚠️ 方向键模式禁止输入数字！只能用 arrow_down/arrow_up + enter**

### 2. 数字输入模式 (selectionType: "number")
**特征**：简单数字列表，无 \`❯\` 标记，需要用户输入数字

**操作原理**：
- 直接输入数字
- 按回车确认

**返回格式**：
\`\`\`json
{
  "selectionType": "number",
  "steps": [
    { "action": "type", "text": "2" },
    { "action": "enter" }
  ],
  "feedback": "已选择 修改现有文件"
}
\`\`\`

### 3. 确认模式 (selectionType: "confirm")
**特征**：有 (y/n) 或 [Y/n] 提示

**返回格式**：
\`\`\`json
{
  "selectionType": "confirm",
  "steps": [
    { "action": "type", "text": "y" },
    { "action": "enter" }
  ],
  "feedback": "已确认"
}
\`\`\`

## PTY 操作步骤类型

| action | 参数 | 说明 | ANSI 转义码 |
|--------|------|------|------------|
| \`arrow_up\` | count | 按上箭头 count 次 | \\x1b[A |
| \`arrow_down\` | count | 按下箭头 count 次 | \\x1b[B |
| \`type\` | text | 输入文本 | 直接发送 |
| \`enter\` | - | 按回车确认 | \\r |

## 关键规则

1. **必须从【终端输出】中提取 defaultOptionIndex**，不能使用之前的分析结果
2. **方向键模式不能输入数字**，只能用 arrow_down/arrow_up + enter
3. **targetOption 是用户想选的选项序号**（从用户回复中提取）
4. **只返回 JSON**，不要其他内容
5. **必须返回 steps 数组**`,

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
