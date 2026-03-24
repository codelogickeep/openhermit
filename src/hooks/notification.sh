#!/bin/bash
# OpenHermit Hook - Notification
# 在 Claude Code 发送通知时触发
# 从 stdin 读取 Claude Code 传递的 JSON 数据

HOOK_DATA=$(cat)

# 使用默认端口 31337（监控模式下环境变量可能不存在）
IPC_PORT="${HERMIT_IPC_PORT:-31337}"

# 发送到 IPC 服务
# 如果 IPC Server 未启动，静默失败（不影响 Claude Code）
curl -s -X POST "http://127.0.0.1:${IPC_PORT}/hook/notification" \
  -H "Content-Type: application/json" \
  -d "${HOOK_DATA}" \
  --connect-timeout 1 \
  --max-time 3 \
  2>/dev/null

# 返回 exit 0
exit 0
