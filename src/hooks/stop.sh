#!/bin/bash
# OpenHermit Hook - Stop
# 在 Claude Code 任务完成时触发
# 从 stdin 读取 Claude Code 传递的 JSON 数据

HOOK_DATA=$(cat)

# 发送到 IPC 服务（HERMIT_IPC_PORT 由 PTY 环境变量注入）
curl -s -X POST "http://127.0.0.1:${HERMIT_IPC_PORT}/hook/stop" \
  -H "Content-Type: application/json" \
  -d "${HOOK_DATA}" \
  --connect-timeout 2 \
  --max-time 5 \
  2>/dev/null

# 返回 exit 0
exit 0
