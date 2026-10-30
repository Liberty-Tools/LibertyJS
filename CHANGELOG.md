# Changelog

This file records release history. For current setup, see the [README](readme.md).
For known limitations and planned fixes, see the [roadmap](ROADMAP.md).

## 1.3.0

Stable release of the command router, TypeScript declarations, and v2 Poll
support developed and tested in the 1.3.0 beta series. Includes cursor-based
Poll pagination, private subscription credentials, retryable failed handlers,
and cancellation-safe rate-limit waits.

## 1.3.0-beta.2 (local release candidate)

### Fixed

- Poll command routing follows cursor pages so later events remain reachable.
- Failed handlers stay pending for retry instead of being acknowledged.
- Poll rate-limit waits can be canceled during shutdown and no longer block ER:LC command requests.
- The two runnable examples use v2 subscription IDs and private Poll tokens instead of the legacy public webhook ID.

### Added

- `webhook.listEvents({ cursor, limit })` and `webhook.events({ cursor, limit })` for manual v2 Poll pagination.
- Regression tests for pagination, failed-handler retry, independent request paths, and shutdown during a retry delay.

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
- Signed webhook verification rejects stale timestamps; private replies resolve the triggering player ID
- Poll shutdown avoids overlapping loops and ignores expected abort errors
- Network errors omit the underlying cause because custom fetch errors can contain credentials
- Package version set to `1.3.0-beta.1` for live testing before a stable release

### Compatibility

- Existing server-query, remote-command, webhook verification, and
  `webhook.events()` APIs remain available.
