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
├── src/
│   ├── index.js          # Entry point & app integration
│   ├── config/
│   │   └── index.js      # Configuration loading, validation & env check
│   ├── pty/
│   │   ├── engine.js     # PTY lifecycle management
│   │   └── envBuild.js   # Environment variable injection
│   ├── channel/
│   │   └── dingtalk.js   # DingTalk Stream SDK wrapper
│   ├── purifier/
│   │   ├── stripper.js   # ANSI stripping & noise filtering
│   │   └── hitl.js       # Human-in-the-loop detection
│   └── utils/
│       └── logger.js      # Pino logger
└── tests/
    ├── envBuild.test.js
    ├── stripper.test.js
    ├── hitl.test.js
    └── simulate-dingtalk.test.js
```

## Core Architecture

### Data Flow

**Inbound (DingTalk → PTY):**
1. User sends message via DingTalk
2. `channel/dingtalk.js` receives Text
3. Built-in commands (`/cd`, `/ls`, `/restart`) handled in Node
4. Plain text → `pty.write()` → injected to terminal

**Outbound (PTY → DingTalk):**
1. PTY receives output from Claude Code
2. **Purifier:** Strip ANSI codes, filter loading animations
3. **HITL Detector:** Check for `(y/n)`, `Allow` patterns
   - If HITL triggered: Pause output, send ActionCard for approval
4. **Debounce:** Buffer output, send every 1.5s to avoid rate limits
5. **Chunking:** Split messages > 2000 bytes with `[1/N]` header

### Security

- **Working Directory Whitelist:** Only operations within `ALLOWED_ROOT_DIR` are permitted
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

All tests pass (57 tests):
- envBuild.js: 5 tests
- stripper.js: 11 tests
- hitl.js: 9 tests
- integration.test.js: 16 tests
- simulate-dingtalk.test.js: 16 tests
