# Changelog

## 1.3.2

Bug-fix release. No new features beyond the `maxAttempts` setting that the retry fix needs.

### Fixed

- Failed command handlers back off before retrying (1s doubling to a 60s cap) and stop after `maxAttempts` (default 5). The final failure is acknowledged so a permanently broken handler no longer reruns every Poll interval. Failed results include `attempts`, `willRetry`, and `retryAt`.
- `context.reply()` and `context.announce()` return `error: "command_failed"` when ERLC rejects the command, so a plain `result.error` check catches it. The existing `failures` and `failureReasons` fields are unchanged.
- Events that finished running before `commands.stop()` are still acknowledged during shutdown. Previously the stop signal canceled that acknowledgement, so a restart could run the same command again.
- A failure waiting to retry is no longer pushed out of the bounded event history by newer events, which could reset its attempt count and exceed `maxAttempts` on busy servers.
- `context.announce()` with an invalid message now returns a rejected promise, like `reply()`, instead of throwing synchronously.
- Expired player-name cache entries are removed, so long-running bots no longer keep an entry for every player who ever used a reply.
- The bundled examples catch a `stop()` timeout on Ctrl+C instead of crashing with an unhandled rejection.
- Removed outdated "1.3.0" references from the README and roadmap.

### Added

- `maxAttempts` option for `commands.command(name, handler, options)`.

## 1.3.1

### Fixed

- Incomplete or malformed successful HTTP responses report an error instead of falsely counting commands as successful. Ambiguous commands are not automatically replayed; empty responses remain supported.
- Direct signed webhook handling unpacks ERLC event batches, maps origin and server identity, rejects malformed batches before partial processing, and returns ordered per-event results. Single-event runtime results remain unchanged; TypeScript webhook callers can use the new `CommandWebhookResult` union.
- Failed command handlers release only their own cooldown reservation and remain pending during a newer cooldown. Concurrent duplicate deliveries wait for the original outcome; successful handlers are not rerun after an acknowledgement failure.
- Scope authentication failures and resets to ERLC requests so valid LibertyTools Poll reads, acknowledgements, and health calls remain independent.

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
