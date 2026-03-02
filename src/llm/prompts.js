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
- built_in: OpenHermit 系统命令（以 - 开头，如 -cd、-ls、-claude、-status）
- claude_command: 其他所有内容，转发给 Claude 终端

## 输出格式
返回 JSON：{"type": "<意图类型>", "command": "<具体命令/任务描述>", "params": {}, "confidence": 0.0-1.0}

## 重要规则
1. 以 - 开头的消息是系统命令，由 OpenHermit 处理
2. 其他所有内容都转发给 Claude 终端

## 示例

### 系统命令（OpenHermit 内置）
用户: "-cd myproject"
返回: {"type": "built_in", "command": "cd", "params": {"args": "myproject"}, "confidence": 1.0}

用户: "-ls"
返回: {"type": "built_in", "command": "ls", "params": {}, "confidence": 1.0}

用户: "-claude" 或 "-claude 帮我写代码"
返回: {"type": "built_in", "command": "claude", "params": {"args": "帮我写代码"}, "confidence": 1.0}

用户: "-status"
返回: {"type": "built_in", "command": "status", "params": {}, "confidence": 1.0}

### Claude 内容（转发给 Claude）
用户: "帮我分析一下这个项目的代码结构"
返回: {"type": "claude_command", "command": "帮我分析一下这个项目的代码结构", "params": {}, "confidence": 1.0}

用户: "/help"
返回: {"type": "claude_command", "command": "/help", "params": {}, "confidence": 1.0}

用户: "cd src"
返回: {"type": "claude_command", "command": "cd src", "params": {}, "confidence": 1.0}

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

请分析并返回 JSON：`,

  /**
   * 智能上下文处理 Prompt
   * 结合终端输出和用户输入，智能判断如何处理
   */
  contextProcess: `你是一个终端交互助手。分析终端输出和用户输入，决定如何处理。

## 任务
1. 分析终端输出，判断当前状态和选择方式
2. 分析用户输入，结合终端上下文
3. 决定如何处理用户输入

## 终端状态类型
- waiting_input: 终端在等待用户输入（如选择选项、确认操作等）
- processing: 终端正在处理中
- idle: 终端空闲

## 选择方式（重要！）
1. **数字选择**：终端显示 "请输入数字" 或 "1. xxx 2. xxx" 但没有默认选中标记
   - 直接输入数字即可

2. **方向键选择**：终端显示选项列表，且有一个默认选中（通常有 ✅、→、> 等标记）
   - 选择默认选项：直接回车（action.value 为空字符串 ""）
   - 选择其他选项：需要按方向键移动后回车

## 输出格式
返回 JSON：
{
  "terminalState": "waiting_input|processing|idle",
  "inputType": "selection|confirm|text|command",
  "selectionType": "arrow|number",
  "action": {
    "type": "select|confirm|write",
    "value": "<要输入的内容>",
    "arrowCount": <需要按几次方向键，0表示直接回车>
  },
  "confidence": 0.0-1.0
}

## 示例

### 示例1：方向键选择 - 选择默认选项
终端输出:
"Select Option:
1. ✅ Yes, I trust this folder
2. ❌ No, exit"
用户输入: "1" 或 "选择1" 或 "第一个"

分析：选项1已默认选中（有✅），选择它只需回车

返回:
{
  "terminalState": "waiting_input",
  "inputType": "selection",
  "selectionType": "arrow",
  "action": {
    "type": "select",
    "value": "",
    "arrowCount": 0
  },
  "confidence": 0.95
}

### 示例2：方向键选择 - 选择其他选项
终端输出:
"Select Option:
1. ✅ Yes, I trust this folder
2. ❌ No, exit"
用户输入: "2" 或 "选择2" 或 "第二个"

分析：选项1默认选中，要选选项2需要按1次↓然后回车

返回:
{
  "terminalState": "waiting_input",
  "inputType": "selection",
  "selectionType": "arrow",
  "action": {
    "type": "select",
    "value": "",
    "arrowCount": 1
  },
  "confidence": 0.95
}

### 示例3：数字选择
终端输出:
"请选择:
1. 创建新文件
2. 修改现有文件"
用户输入: "1"

分析：没有默认选中标记，直接输入数字

返回:
{
  "terminalState": "waiting_input",
  "inputType": "selection",
  "selectionType": "number",
  "action": {
    "type": "select",
    "value": "1",
    "arrowCount": 0
  },
  "confidence": 0.95
}

### 示例4：y/n 确认
终端输出:
"Allow this action? (y/n)"
用户输入: "y" 或 "同意"

返回:
{
  "terminalState": "waiting_input",
  "inputType": "confirm",
  "selectionType": "confirm",
  "action": {
    "type": "confirm",
    "value": "y",
    "arrowCount": 0
  },
  "confidence": 0.95
}

### 示例5：普通对话/命令
终端输出:
"Claude: 你好"
用户输入: "帮我写个冒泡排序"

返回:
{
  "terminalState": "waiting_input",
  "inputType": "text",
  "selectionType": "text",
  "action": {
    "type": "write",
    "value": "帮我写个冒泡排序",
    "arrowCount": 0
  },
  "confidence": 0.9
}

## 当前上下文
最近的终端输出:
{{terminalOutput}}

用户输入: {{userInput}}

请仔细分析终端输出的选择方式，返回正确的 JSON：`,

  /**
   * 状态输出总结 Prompt
   * 将终端缓冲区内容总结为简洁的状态报告
   */
  summarizeStatus: `你是一个终端输出总结助手。将 Claude Code 的终端输出总结为简洁的状态报告。

## 任务
分析终端输出，提取关键信息并生成简洁的总结。

## 输出要求
1. **当前任务**：Claude 正在做什么？（一句话概括）
2. **进度状态**：如果能看到进度，说明当前进度
3. **等待操作**：如果正在等待用户输入，说明需要什么操作
4. **最近结果**：最近完成的关键操作或输出（如果有）

## 格式要求
- 使用简洁的 Markdown 格式
- 总长度控制在 200 字以内
- 如果输出内容太少或无法理解，返回 "暂无有效输出"
- 不要添加额外说明，直接返回总结内容

## 示例

终端输出:
"Thinking...
Analyzing codebase structure...
Found 15 files
> Please select an option:
1. Continue
2. Skip"

总结:
**当前任务**: 分析代码库结构
**进度**: 已发现 15 个文件
**等待操作**: 请选择继续或跳过

---

终端输出:
{{terminalOutput}}

请生成总结：`
};

export default Prompts;
