# Changelog

## 1.3.0-beta.1

### Added

- Easy custom-command routing through `erlc.commands`
- Poll lifecycle with immediate polling, clean shutdown, and external cancellation
- Per-player command cooldowns and duplicate-event protection
- Quoted command-argument parsing
- `reply()` and `announce()` command-context helpers
- Direct signed-webhook handling through `commands.handleWebhook()`
- Manual authenticated event handling through `commands.handle()`
- TypeScript declarations and strict NodeNext/Bundler consumer checks
- Runnable Poll-mode command example and Node 18–24 CI matrix

### Changed

- Webhook relay error messages no longer include credential-bearing request URLs
- Package version set to `1.3.0-beta.1` for live testing before a stable release

### Compatibility

- Existing server-query, remote-command, webhook verification, and
  `webhook.events()` APIs remain available.
