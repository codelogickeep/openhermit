#!/bin/bash
# OpenHermit Hook - Notification
# 在 Claude Code 发送通知时触发
# 支持双向通信：轮询等待钉钉命令

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

# 如果是 idle_prompt 状态，进入命令等待模式
if [ "$NOTIFICATION_TYPE" = "idle_prompt" ] && [ -n "$CWD" ]; then
  # 命令目录：项目目录下的 .claude/commands/
  COMMAND_DIR="$CWD/.claude/commands"
  TIMEOUT=600  # 10 分钟
  ELAPSED=0
  CHECK_INTERVAL=1

  # 调试日志
  DEBUG_LOG="$CWD/.claude/notification-debug.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始轮询命令目录: $COMMAND_DIR" >> "$DEBUG_LOG"

  # 等待 IPC 通知完成
  wait

  while [ $ELAPSED -lt $TIMEOUT ]; do
    # 检查命令目录是否存在且有命令文件
    if [ -d "$COMMAND_DIR" ] && ls "$COMMAND_DIR"/*.txt 1>/dev/null 2>&1; then
      # 获取最新的命令文件（按时间戳排序）
      COMMAND_FILE=$(ls -t "$COMMAND_DIR"/*.txt 2>/dev/null | head -1)

      if [ -f "$COMMAND_FILE" ]; then
        # 读取命令内容
        COMMAND=$(cat "$COMMAND_FILE")

        # 调试日志
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 读取到命令: $COMMAND" >> "$DEBUG_LOG"

        # 输出命令到 stdout（Claude Code 会读取作为用户输入）
        echo "$COMMAND"

        # 删除已处理的命令文件
        rm -f "$COMMAND_FILE"

        # 通知 OpenHermit 命令已处理（异步）
        curl -s -X POST "http://127.0.0.1:${IPC_PORT}/command/processed" \
          -H "Content-Type: application/json" \
          -d "{\"file\": \"$COMMAND_FILE\", \"session\": \"$SESSION_ID\", \"command\": \"$COMMAND\"}" \
          --connect-timeout 1 \
          --max-time 2 \
          2>/dev/null &

        exit 0
      fi
    fi

    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
  done

  # 调试日志：超时
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 轮询超时，未找到命令" >> "$DEBUG_LOG"

  # 超时：通知 OpenHermit
  curl -s -X POST "http://127.0.0.1:${IPC_PORT}/command/timeout" \
    -H "Content-Type: application/json" \
    -d "{\"session\": \"$SESSION_ID\", \"timeout\": $TIMEOUT, \"cwd\": \"$CWD\"}" \
    --connect-timeout 1 \
    --max-time 2 \
    2>/dev/null
fi

exit 0
