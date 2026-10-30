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

## Fixes to prioritize

These issues were reproduced during code review and still need fixes:

1. **Raw webhook batches:** `commands.handleWebhook()` verifies signatures but does not unpack ERLC request bodies containing an `events` array. Raw events also need `origin` mapped to the triggering user ID. Add tests using the actual request shape.
2. **Retries with cooldowns:** a failed handler can leave its cooldown active. Its next Poll delivery can be acknowledged as a cooldown without running successfully. Preserve failed work until it can be retried.
3. **Independent authentication:** repeated ERLC authentication failures currently block the same instance's LibertyTools Poll requests. Separate these because they use different credentials.
4. **Request timeouts:** add configurable timeouts and cancellation to server queries and remote commands so stalled requests cannot hold up the shared queue.
5. **Cache cleanup:** bound or remove unused player-cache entries and shared request states in long-running applications.

Each fix needs a regression test. Retrying a handler can repeat side effects if an earlier action succeeded before the handler failed.

## Possible later improvements

- Validated response helpers and event type guards.
- A supported receiver for LibertyTools signed forwards.
- More runnable examples and clearer troubleshooting.
- Command aliases, permissions, and automatic help text.

These are proposals. `webhook.watch()` and a built-in LibertyTools Proxy signature verifier are not available in 1.3.0. Dashboard and gateway plans belong in their respective repositories.

## Before releasing

- Run `npm run check` and `npm pack --dry-run`.
- Cover changed behavior, including failures, with tests.
- Check examples and documentation against the exported API.
- Update the changelog and review compatibility.
- Open a pull request and wait for review and passing CI before merging.
