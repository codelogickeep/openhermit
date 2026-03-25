#!/bin/bash
# OpenHermit Hook - Notification
# 在 Claude Code 发送通知时触发
# 发送状态通知到 IPC 服务，用于钉钉推送

# 从 stdin 读取 Claude Code 传递的 JSON 数据
HOOK_DATA=$(cat)

# 使用默认端口 31337（监控模式下环境变量可能不存在）
IPC_PORT="${HERMIT_IPC_PORT:-31337}"

# 解析通知类型和工作目录
NOTIFICATION_TYPE=$(echo "$HOOK_DATA" | jq -r '.notification_type // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // empty')
CWD=$(echo "$HOOK_DATA" | jq -r '.cwd // empty')

# 发送事件到 IPC 服务（异步，不阻塞）
curl -s -X POST "http://127.0.0.1:${IPC_PORT}/hook/notification" \
  -H "Content-Type: application/json" \
  -d "${HOOK_DATA}" \
  --connect-timeout 1 \
  --max-time 3 \
  2>/dev/null &

# 调试日志
if [ -n "$CWD" ]; then
  DEBUG_LOG="$CWD/.claude/notification-debug.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Notification: type=$NOTIFICATION_TYPE, session=$SESSION_ID" >> "$DEBUG_LOG"
fi

# 注意：Notification hook 无法通过 stdout 提供用户输入
# 双向通信通过 Stop hook 的 decision: "block" 机制实现
# 命令文件写入 .claude/commands/ 目录，由 Stop hook 处理

exit 0
