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

## Milestone 1.3.1: implemented, awaiting release

The milestone changes implement the following fixes. They are not yet available in the published 1.3.0 package:

- **Raw webhook batches:** verify the body once, validate the batch before processing, preserve player/server identities, and return per-event outcomes. Single events retain their runtime result shape.
- **Retries with cooldowns:** release a failed attempt's reservation without clearing newer cooldowns; keep known failed work pending during a newer cooldown. Concurrent duplicate deliveries share the active outcome.
- **Independent authentication:** ERLC authentication failures and resets no longer affect LibertyTools Poll reads, acknowledgements, or health requests.

Regression tests cover these fixes. Retry and duplicate history remain bounded and process-local. Retrying a handler can repeat side effects if an earlier action succeeded before the handler failed.

## Fixes to prioritize

- **Request timeouts:** add configurable timeouts and cancellation to server queries and remote commands so stalled requests cannot hold up the shared queue.
- **Cache cleanup:** bound or remove unused player-cache entries and shared request states in long-running applications.

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
