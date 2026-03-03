/**
 * 意图解析 Prompt
 * 用于解析用户输入的意图
 */

export const IntentPrompts = {
  /**
   * 意图解析 Prompt（增强版）
   * 将用户自然语言转换为结构化意图，支持 shell 命令识别
   */
  parseIntent: `你是一个智能命令解析助手。分析用户消息，判断其意图并返回 JSON 格式结果。

## 意图类型（按优先级排序）
1. **built_in**: OpenHermit 系统命令（最高优先级）
2. **shell_command**: 简单的 shell 命令
3. **claude_command**: 复杂的开发任务
4. **unknown**: 无法理解的输入

## 判断规则（按优先级）

### built_in（系统命令）- 最高优先级
优先匹配以下语义：
- **状态查询**: "状态"、"查看状态"、"当前状态"、"怎么样了" → -status
- **目录操作**: "切换目录"、"进入xx目录"、"换目录" → -cd
- **目录列表**: "有哪些目录"、"可选目录"、"目录列表" → -ls
- **启动 Claude**: "启动"、"开始"、"运行 claude" → -claude
- **帮助**: "帮助"、"怎么用"、"有什么命令" → -help

### shell_command（直接执行）
适用于简单的文件系统操作和信息查询：
- 查看目录/文件: "查看当前目录" → ls, "列出文件" → ls -la
- 查看文件内容: "查看 package.json" → cat package.json
- 切换目录: "进入 src 目录" → cd src
- 当前位置: "当前在哪个目录" → pwd
- Git 操作: "git 状态"、"提交代码" → git status / git add . && git commit -m
- 查看进程: "查看 node 进程" → ps aux | grep node

### claude_command（需要 Claude）
适用于复杂的开发任务：
- 编写代码: "帮我写一个排序函数"
- 分析代码: "分析这个项目的架构"
- 重构: "重构这个模块"
- 调试: "帮我找出 bug"
- 文档: "生成 API 文档"
- 复杂操作: "创建一个新组件并配置路由"

## 输出格式
返回 JSON：
{
  "type": "<意图类型>",
  "command": "<要执行的命令或任务描述>",
  "params": {},
  "confidence": 0.0-1.0,
  "explanation": "<简短解释为什么是这个意图>"
}

## 示例

### Shell 命令
用户: "查看当前目录"
返回: {"type": "shell_command", "command": "ls", "params": {}, "confidence": 0.95, "explanation": "用户想查看当前目录内容"}

用户: "列出所有文件包括隐藏文件"
返回: {"type": "shell_command", "command": "ls -la", "params": {}, "confidence": 0.95, "explanation": "用户想查看所有文件"}

用户: "查看 package.json 的内容"
返回: {"type": "shell_command", "command": "cat package.json", "params": {}, "confidence": 0.9, "explanation": "用户想查看文件内容"}

用户: "git 状态"
返回: {"type": "shell_command", "command": "git status", "params": {}, "confidence": 0.95, "explanation": "用户想查看 git 状态"}

### Claude 命令
用户: "帮我分析一下这个项目的代码结构"
返回: {"type": "claude_command", "command": "帮我分析一下这个项目的代码结构", "params": {}, "confidence": 0.9, "explanation": "需要深度分析代码"}

用户: "写一个冒泡排序"
返回: {"type": "claude_command", "command": "写一个冒泡排序", "params": {}, "confidence": 0.95, "explanation": "需要编写代码"}

用户: "帮我重构这个函数"
返回: {"type": "claude_command", "command": "帮我重构这个函数", "params": {}, "confidence": 0.95, "explanation": "需要代码重构"}

### 系统命令
用户: "-cd myproject"
返回: {"type": "built_in", "command": "cd", "params": {"args": "myproject"}, "confidence": 1.0, "explanation": "系统命令"}

用户: "-status"
返回: {"type": "built_in", "command": "status", "params": {}, "confidence": 1.0, "explanation": "系统命令"}

用户消息: {{userMessage}}

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

请仔细分析终端输出的选择方式，返回正确的 JSON：`
};

export default IntentPrompts;
