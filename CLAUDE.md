# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenHermit (开源寄居蟹) is a lightweight PTY bridge that connects Claude Code (and other local CLI agents) to mobile messaging platforms (DingTalk in Phase 1). It enables remote access to your local AI development environment through your phone without requiring public IP or ngrok.

**Status:** Phase 1 (DingTalk integration) - Implemented

## Tech Stack

- **Runtime:** Node.js v18+
- **Core:** `node-pty` (pseudo-terminal emulation)
- **Channel:** `dingtalk-stream-sdk-nodejs` (WebSocket connection to DingTalk)
- **Utilities:** `strip-ansi`, `lodash.debounce`, `dotenv`, `pino`
- **Testing:** `vitest`

## Directory Structure

```
openhermit/
├── .env.example          # Environment config template
├── package.json
├── vitest.config.js
├── docs/
│   └── plans/            # Design documents
├── src/
│   ├── index.js          # Entry point & app integration
│   ├── config/
│   │   └── index.js      # Configuration loading, validation & env check
│   ├── core/
│   │   ├── message-handler.js  # Message processing logic
│   │   ├── system-commands.js  # System commands (-cd, -ls, etc.)
│   │   ├── security.js         # Command security analyzer
│   │   ├── task-manager.js     # Task status management
│   │   └── hitl-controller.js  # Human-in-the-loop controller
│   ├── pty/
│   │   ├── engine.js     # PTY lifecycle management
│   │   └── envBuild.js   # Environment variable injection
│   ├── channel/
│   │   └── dingtalk.js   # DingTalk Stream SDK wrapper
│   ├── intent/
│   │   └── parser.js     # Intent parsing
│   ├── llm/
│   │   ├── client.js     # LLM API client
│   │   └── prompts/      # LLM prompts
│   ├── purifier/
│   │   ├── stripper.js   # ANSI stripping & noise filtering
│   │   └── hitl.js       # Human-in-the-loop detection
│   └── utils/
│       └── logger.js     # Pino logger
└── tests/
    ├── envBuild.test.js
    ├── stripper.test.js
    ├── hitl.test.js
    ├── security.test.js
    └── simulate-dingtalk.test.js
```

## Core Architecture

### Data Flow

**Inbound (DingTalk → PTY):**
1. User sends message via DingTalk (text or voice)
2. `channel/dingtalk.js` receives message
3. Voice messages are converted using DingTalk's speech recognition
4. Message routing based on Claude terminal state:
   - **Claude Active**: Messages sent directly to Claude terminal
   - **Claude Idle**: LLM intent recognition → Security check → Execute
5. Built-in commands (`-cd`, `-ls`, `-claude`, `-status`) handled by system
6. Plain text → `pty.write()` → injected to terminal

**Outbound (PTY → DingTalk):**
1. PTY receives output from Claude Code
2. **Purifier:** Strip ANSI codes, filter loading animations
3. **HITL Detector:** Check for `(y/n)`, `Allow` patterns
   - If HITL triggered: Pause output, send ActionCard for approval
4. **Debounce:** Buffer output, send every 1.5s to avoid rate limits
5. **Chunking:** Split messages > 2000 bytes with `[1/N]` header

### Features

**Voice Message Support:**
- Supports DingTalk voice messages
- Uses DingTalk's built-in speech recognition
- Voice messages are processed like text messages

**LLM Intent Recognition (Idle Mode):**
- When Claude terminal is not running, messages are analyzed by LLM
- Recognizes shell commands, Claude tasks, and system commands
- Natural language to command conversion (e.g., "查看当前目录" → `ls`)

**Command Security:**
- All commands are analyzed for security risks before execution
- Risk levels: LOW, MEDIUM, HIGH, CRITICAL
- CRITICAL commands are blocked
- HIGH commands trigger warnings

### Security

- **Working Directory Whitelist:** Only operations within `ALLOWED_ROOT_DIR` are permitted
- **Command Security Analyzer:** Detects dangerous commands (rm -rf /, sudo, etc.)
- **Sensitive Path Protection:** Blocks access to /etc, /root, ~/.ssh
- **HITL Protection:** Dangerous commands require human approval via ActionCard

## Commands

```bash
npm install          # Install dependencies
npm start           # Run the application
npm run dev         # Development mode (with watch)
npm test            # Run tests (vitest)
```

## Configuration

Create `.env` from `.env.example`:

```bash
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
ALLOWED_ROOT_DIR=/Users/xxx/projects
# Optional:
# DASHSCOPE_API_KEY=sk-xxx    # For LLM intent recognition
# DASHSCOPE_MODEL=qwen-turbo  # LLM model
# ANTHROPIC_API_KEY=sk-ant-xxx
# ANTHROPIC_BASE_URL=https://proxy.com/v1
```

## Environment Requirements

### Required
- Node.js v18+
- macOS or Linux
- Valid DingTalk AppKey and AppSecret
- Valid ALLOWED_ROOT_DIR (must exist)

### Dependencies
- `node-pty` - PTY support (native module, may require rebuild)
- `dingtalk-stream-sdk-nodejs` - DingTalk SDK (optional, mock mode if unavailable)

### Environment Check

On startup, the application performs automatic environment checks:
- Node.js version
- Required environment variables
- Working directory existence
- Platform compatibility
- Shell availability

If any check fails, the application will exit with specific error messages.

### Troubleshooting

**node-pty installation issues:**
```bash
# Rebuild node-pty
npm rebuild node-pty

# Or install from source
npm install node-pty --build-from-source
```

**DingTalk connection timeout:**
- Check network/proxy settings
- Verify AppKey and AppSecret
- Application will fall back to mock mode if connection fails

## Testing

All tests pass (195 tests):
- envBuild.js: 5 tests
- stripper.js: 19 tests
- hitl.js: 10 tests
- security.js: 29 tests (command security detection)
- integration.test.js: tests
- user-flow.test.js: 8 tests
- dingtalk-channel.test.js: 19 tests
- simulate-dingtalk.test.js: 16 tests
- smart-interaction/: LLM integration tests
