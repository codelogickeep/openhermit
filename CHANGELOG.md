# Changelog

All notable changes to OpenHermit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-03-10

### Added
- **HITL Security Confirmation**: High-risk commands now require user confirmation before execution
  - Commands with HIGH risk level trigger y/n confirmation dialog
  - Security pending state management in HitlController

### Changed
- **Intent Parser Refactoring**: Simplified intent parsing logic
  - Removed duplicate code in `quickParse` and `quickParseSimple` methods
  - All non-system commands now default to Claude in idle mode
  - Improved code maintainability

### Documentation
- **CLAUDE.md Refresh**: Updated project documentation to reflect current architecture
  - Added Shadow Hook Injection documentation
  - Added Smart Interaction mode documentation
  - Updated directory structure and configuration options
- **CODE-REVIEW.md**: Added code completeness review document

## [1.3.1] - 2026-03-08

### Fixed
- Fixed `-status` command priority handling when Claude is active
- Fixed built-in commands triggering LLM interaction analysis

## [1.3.0] - 2026-03-06

### Added
- **Shadow Hook Injection**: Integrated Claude Code native Hooks system
  - PreToolUse, Notification, Stop hooks
  - IPC Server for receiving hook events
  - Hook state machine management

### Changed
- **Directory Structure**: Reorganized source code
  - Added `src/hooks/` for hook scripts
  - Added `src/core/ipc-server.js` and `src/core/hook-handler.js`
  - Improved module organization

## [1.2.0] - 2026-03-03

### Added
- **Voice Message Support**: Support for DingTalk voice messages with speech recognition
- **LLM Intent Recognition**: Integration with Alibaba DashScope (Qwen) for natural language understanding
- **Smart Interaction Mode**: Enhanced terminal output analysis and formatting
  - Output formatting to Markdown
  - Selection detection and handling
  - Context-aware reply parsing

### Changed
- **Message Routing**: Improved message handling based on Claude terminal state
  - Active mode: Direct message forwarding
  - Idle mode: LLM intent recognition with security check

## [1.1.0] - 2026-02-28

### Added
- **Security Analyzer**: Command security detection system
  - 30+ dangerous command pattern detection
  - Risk level assessment (LOW/MEDIUM/HIGH/CRITICAL)
  - Command injection prevention
  - Sensitive path protection

### Security
- Path whitelist validation
- Dangerous command blocking (rm -rf /, reverse shell, etc.)

## [1.0.0] - 2026-02-25

### Added
- Initial release
- PTY bridge for Claude Code
- DingTalk Stream SDK integration
- Terminal output purification (ANSI stripping)
- HITL (Human-in-the-loop) controller
- System commands (-cd, -ls, -claude, -status, -help)
- Silent mode with on-demand delivery
- Terminal logging

---

## Version History Summary

| Version | Date | Key Features |
|---------|------|--------------|
| 1.3.3 | 2026-03-10 | HITL Security Confirmation, Intent Parser Refactoring |
| 1.3.1 | 2026-03-08 | -status command priority fix |
| 1.3.0 | 2026-03-06 | Shadow Hook Injection |
| 1.2.0 | 2026-03-03 | Voice Messages, LLM Intent Recognition |
| 1.1.0 | 2026-02-28 | Security Analyzer |
| 1.0.0 | 2026-02-25 | Initial Release |
