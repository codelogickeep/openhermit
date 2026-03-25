#!/bin/bash
# OpenHermit Hook - Stop
# 在 Claude Code 任务完成时触发
# 支持双向通信：检查是否有待执行的命令，如果有则阻止停止并执行新命令

# 从 stdin 读取 Claude Code 传递的 JSON 数据
HOOK_DATA=$(cat)

# 使用默认端口 31337（监控模式下环境变量可能不存在）
IPC_PORT="${HERMIT_IPC_PORT:-31337}"

# 解析工作目录和会话 ID
CWD=$(echo "$HOOK_DATA" | jq -r '.cwd // empty')
SESSION_ID=$(echo "$HOOK_DATA" | jq -r '.session_id // empty')

# 发送事件到 IPC 服务（异步，不阻塞）
curl -s -X POST "http://127.0.0.1:${IPC_PORT}/hook/stop" \
  -H "Content-Type: application/json" \
  -d "${HOOK_DATA}" \
  --connect-timeout 1 \
  --max-time 3 \
  2>/dev/null &

# 如果有工作目录，检查是否有待执行的命令
if [ -n "$CWD" ]; then
  # 命令目录：项目目录下的 .claude/.openhermit/commands/
  COMMAND_DIR="$CWD/.claude/.openhermit/commands"
  TIMEOUT=30  # 最多等待 30 秒
  ELAPSED=0
  CHECK_INTERVAL=1

  # 调试日志
  DEBUG_LOG="$CWD/.claude/stop-debug.log"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Stop Hook 触发，检查命令目录: $COMMAND_DIR" >> "$DEBUG_LOG"

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
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 发现待执行命令: $COMMAND" >> "$DEBUG_LOG"

        # 删除已处理的命令文件
        rm -f "$COMMAND_FILE"

        # 通知 OpenHermit 命令已处理（异步）
        curl -s -X POST "http://127.0.0.1:${IPC_PORT}/command/processed" \
          -H "Content-Type: application/json" \
          -d "{\"file\": \"$COMMAND_FILE\", \"session\": \"$SESSION_ID\", \"command\": \"$COMMAND\"}" \
          --connect-timeout 1 \
          --max-time 2 \
          2>/dev/null &

        # 返回 decision: "block" 阻止 Claude 停止，并提供新命令
        # reason 字段会作为新的指令被 Claude 执行
        echo "{\"decision\": \"block\", \"reason\": \"继续执行用户的新指令: $COMMAND\"}"
        exit 0
      fi
    fi

    sleep $CHECK_INTERVAL
    ELAPSED=$((ELAPSED + CHECK_INTERVAL))
  done

  # 调试日志：超时
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 未找到待执行命令，允许 Claude 停止" >> "$DEBUG_LOG"
fi

# 没有待执行的命令，允许 Claude 正常停止
exit 0
