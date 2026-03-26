#!/bin/bash
# OpenHermit Hook - PreToolUse
# 在 Claude Code 执行工具前触发
# 支持权限确认：发送通知到钉钉，等待用户决策
# 从 stdin 读取 Claude Code 传递的 JSON 数据

HOOK_DATA=$(cat)

# 使用默认端口 31337（监控模式下环境变量可能不存在）
IPC_PORT="${HERMIT_IPC_PORT:-31337}"

# 解析关键字段
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // empty')
CWD=$(echo "$HOOK_DATA" | jq -r '.cwd // empty')
PERMISSION_MODE=$(echo "$HOOK_DATA" | jq -r '.permission_mode // empty')

# 调试日志目录
if [ -n "$CWD" ]; then
  DEBUG_LOG="$CWD/.claude/pre-tool-debug.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] PreToolUse: tool=$TOOL_NAME, mode=$PERMISSION_MODE" >> "$DEBUG_LOG"
fi

# 检测 OpenHermit IPC 服务是否可用
# 如果服务不可用，直接放行，不阻塞
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${IPC_PORT}/health" --connect-timeout 1 --max-time 2 2>/dev/null)
if [ "$HEALTH_CHECK" != "200" ]; then
  if [ -n "$CWD" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] OpenHermit 服务未运行，直接放行" >> "$DEBUG_LOG"
  fi
  exit 0
fi

# 如果是 bypassPermissions 模式，直接允许
if [ "$PERMISSION_MODE" = "bypassPermissions" ]; then
  # 发送事件到 IPC（用于日志记录）
  curl -s -X POST "http://127.0.0.1:${IPC_PORT}/hook/pre-tool" \
    -H "Content-Type: application/json" \
    -d "${HOOK_DATA}" \
    --connect-timeout 1 \
    --max-time 3 \
    2>/dev/null
  exit 0
fi

# 需要用户确认的情况
# 发送权限确认请求到 IPC 服务
# IPC 服务会推送钉钉消息并返回一个 permissionId
RESPONSE=$(curl -s -X POST "http://127.0.0.1:${IPC_PORT}/hook/pre-tool" \
  -H "Content-Type: application/json" \
  -d "${HOOK_DATA}" \
  --connect-timeout 2 \
  --max-time 10 \
  2>/dev/null)

# 解析响应
PERMISSION_ID=$(echo "$RESPONSE" | jq -r '.permissionId // empty')
NEEDS_CONFIRM=$(echo "$RESPONSE" | jq -r '.needsConfirm // false')

# 如果不需要确认，直接允许
if [ "$NEEDS_CONFIRM" = "false" ] || [ -z "$PERMISSION_ID" ]; then
  exit 0
fi

# 需要确认，进入等待模式
if [ -n "$CWD" ]; then
  PERMISSION_DIR="$CWD/.claude/.openhermit/permissions"
  TIMEOUT=120  # 2 分钟超时
  ELAPSED=0
  CHECK_INTERVAL=1

  # 确保目录存在
  mkdir -p "$PERMISSION_DIR" 2>/dev/null

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 等待用户确认: permissionId=$PERMISSION_ID" >> "$DEBUG_LOG"

  while [ $ELAPSED -lt $TIMEOUT ]; do
    # 检查决策文件
    DECISION_FILE="$PERMISSION_DIR/${PERMISSION_ID}.decision"

    if [ -f "$DECISION_FILE" ]; then
      DECISION=$(cat "$DECISION_FILE")

      # 删除决策文件
      rm -f "$DECISION_FILE"

      # 通知 IPC 服务决策已处理
      curl -s -X POST "http://127.0.0.1:${IPC_PORT}/permission/processed" \
        -H "Content-Type: application/json" \
        -d "{\"permissionId\": \"$PERMISSION_ID\", \"decision\": \"$DECISION\"}" \
        --connect-timeout 1 \
        --max-time 2 \
        2>/dev/null &

      # 记录日志
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] 用户决策: $DECISION" >> "$DEBUG_LOG"

      # 返回决策
      if [ "$DECISION" = "allow" ]; then
        exit 0
      else
        # 返回 deny 决策
        echo "{\"decision\": \"deny\", \"reason\": \"用户拒绝执行此操作\"}"
        exit 0
      fi
    fi

    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
  done

  # 超时：通知 IPC 服务
  curl -s -X POST "http://127.0.0.1:${IPC_PORT}/permission/timeout" \
    -H "Content-Type: application/json" \
    -d "{\"permissionId\": \"$PERMISSION_ID\", \"timeout\": $TIMEOUT}" \
    --connect-timeout 1 \
    --max-time 2 \
    2>/dev/null &

  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 权限确认超时，默认拒绝" >> "$DEBUG_LOG"

  # 超时默认拒绝
  echo "{\"decision\": \"deny\", \"reason\": \"等待用户确认超时\"}"
fi

exit 0
