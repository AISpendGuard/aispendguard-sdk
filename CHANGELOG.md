# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-03-15

### Added
- Streaming response documentation (OpenAI + Anthropic examples)

### Fixed
- Node.js 20 deprecation warning in GitHub Actions

## [0.1.1] - 2026-03-14

### Fixed
- Improved error messages with URL, status, and actionable hints
- npm trusted publishing workflow

## [0.1.0] - 2026-03-14

### Added
- Initial release
- `init()`, `trackUsage()` core API
- Provider helpers: `createOpenAIUsageEvent`, `createAnthropicUsageEvent`, `createGeminiUsageEvent`
- Auto-wrap helpers: `wrapOpenAI`, `wrapAnthropic`, `wrapGemini`
- LangChain.js callback handler (`AISpendGuardCallbackHandler`)
- `defaultTags` configuration for auto-wrapped calls
- Privacy guard: forbidden tag key validation
- Fire-and-forget tracking (non-strict mode)
