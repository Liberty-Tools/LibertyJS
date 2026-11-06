# LibertyJS roadmap

This file tracks proposed SDK improvements, not available features or promised release dates. Start with the [README](readme.md) to use the package and the [changelog](CHANGELOG.md) for release history.

## Available in 1.3.0

- ERLC API v2 server queries and remote commands.
- Shared rate-limit tracking and automatic retries after HTTP 429 responses.
- TypeScript declarations for SDK options, methods, and command handlers.
- LibertyTools Poll subscriptions with private credentials, pagination, and acknowledgements.
- Custom-command handlers, per-player cooldowns, reply helpers, and Poll shutdown.
- Official webhook signature verification and routing of individual authenticated command events.

Raw API and Poll responses are unvalidated JSON. Callers must check their shape before reading fields.

## Fixed in 1.3.1

Version 1.3.1 includes the following fixes:

- **Raw webhook batches:** verify the body once, validate the batch before processing, preserve player/server identities, and return per-event outcomes. Single events retain their runtime result shape.
- **Retries with cooldowns:** release a failed attempt's reservation without clearing newer cooldowns; keep known failed work pending during a newer cooldown. Concurrent duplicate deliveries share the active outcome.
- **Independent authentication:** ERLC authentication failures and resets no longer affect LibertyTools Poll reads, acknowledgements, or health requests.

Regression tests cover these fixes. Retry and duplicate history remain bounded and process-local. Retrying a handler can repeat side effects if an earlier action succeeded before the handler failed.

## Fixed in 1.3.2

- **Bounded retries:** failed handlers back off between attempts and stop after `maxAttempts`, then the event is acknowledged. Pending retries and finished events are tracked separately so neither can push the other out.
- **Clear reply errors:** rejected replies and announcements return `error: "command_failed"`.
- **Clean shutdown:** events that already ran are acknowledged even while `stop()` is in progress.
- **Smaller fixes:** expired player-cache entries are removed, `announce()` rejects instead of throwing synchronously, and the examples handle a `stop()` timeout.

## Fixes to prioritize

- **Request timeouts:** add configurable timeouts and cancellation to server queries and remote commands so stalled requests cannot hold up the shared queue.
- **Shared request state cleanup:** remove per-key rate-limit state that is no longer used in long-running applications. (Expired player-cache entries are cleaned up as of 1.3.2.)

## Possible later improvements

- Validated response helpers and event type guards.
- A supported receiver for LibertyTools signed forwards.
- More runnable examples and clearer troubleshooting.
- Command aliases, permissions, and automatic help text.

These are proposals. `webhook.watch()` and a built-in LibertyTools Proxy signature verifier are not available yet. Dashboard and gateway plans belong in their respective repositories.

## Before releasing

- Run `npm run check` and `npm pack --dry-run`.
- Cover changed behavior, including failures, with tests.
- Check examples and documentation against the exported API.
- Update the changelog and review compatibility.
- Open a pull request and wait for review and passing CI before merging.
