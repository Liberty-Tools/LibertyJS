# LibertyJS 1.3: command routing and reliable Poll events

## Release goal

Make LibertyJS useful for building interactive server commands without requiring
developers to write their own polling loop, event matcher, cooldown system, player
resolver, and ER:LC response command. The flagship flow is: when a player runs
`;help`, the SDK invokes a handler that can privately reply to that same player.

Reliable Poll retrieval supports that feature. A visual dashboard rule builder is
a later product goal, after the SDK API and behavior have proven themselves in real
applications.

The proposed public SDK version is `1.3.0`. Backend and dashboard changes should
ship first as additive endpoints so the current webhook URLs keep working.

## What exists today

### LibertyJS

- ER:LC v2 server queries and commands
- shared rate-limit coordination and retry handling
- official webhook signature verification
- one-shot Liberty Tools Poll retrieval through `webhook.events()`
- TypeScript declarations and type-consumer checks implemented on the current
  local branch

The SDK currently returns relay JSON directly. It has no event schema, cursor,
acknowledgement API, continuous poller, request cancellation, or event-level
deduplication.

### Dashboard

- Roblox OAuth login
- create and update Poll, Easy, and Proxy webhooks
- ownership checks before updates
- rate limits and basic security headers

The UI cannot show recent events or webhook health. It hard-codes the two-webhook
limit even though the server returns that limit. The server retrieves the complete
upstream webhook list and filters it locally, uses the default in-memory session
store, and has no automated tests.

### API and prototype

The production Poll endpoint currently returns `{ count, events }`. A verified
live request returned a probe and two custom-command events, so ingestion works.
The production backend repository was not present in the accessible Liberty Tools
repositories and must be located before implementation.

`TestingGatewayERLC` contains useful prototype concepts: pending events, cursors,
acknowledgements, signature verification, and server-sent event delivery. Its
routes and event shape differ from production. Treat it as reference code; do not
introduce its contract alongside the current contract.

## Workstream 1: backend event contract and queue

Build this first. The SDK and dashboard should consume the same versioned contract.

### Stable event envelope

Return every event in a consistent envelope while keeping the original ER:LC
payload available:

```json
{
  "id": "evt_...",
  "type": "CustomCommand",
  "occurredAt": "2026-10-16T14:21:47.000Z",
  "receivedAt": "2026-10-16T14:21:47.783Z",
  "serverId": "...",
  "data": {
    "userId": "...",
    "command": "help",
    "argument": ""
  }
}
```

Use ISO timestamps at the API boundary. Preserve unknown event types rather than
rejecting them so new ER:LC events do not require an emergency backend release.

### Reliable retrieval

Add versioned, owner-scoped endpoints:

- `GET /v1/webhooks/:id/events?cursor=...&limit=...&state=pending`
- `POST /v1/webhooks/:id/events/ack` with an array of event IDs
- `GET /v1/webhooks/:id/status`
- `POST /v1/webhooks/:id/test`
- `POST /v1/webhooks/:id/rotate-poll-token`
- `DELETE /v1/webhooks/:id`

The event response should be:

```json
{
  "events": [],
  "nextCursor": null,
  "hasMore": false,
  "pendingCount": 0
}
```

Reading must not acknowledge or delete events. Acknowledgement happens only after
the consumer successfully handles an event. Make acknowledgement idempotent.
Use a stable cursor based on ordered event identity rather than a client timestamp.

### Credentials and ownership

Separate the public ER:LC ingest identifier from the private Poll read token. The
current webhook URL is necessarily visible to ER:LC and should not also grant read
access to queued event data. Accept Poll credentials in an authorization header,
not a query string, so reverse proxies and logs are less likely to record them.

Existing webhooks should keep their ingest URLs. Generate a Poll token for each
existing Poll webhook during migration and allow users to rotate it. Dashboard
management endpoints must query by the authenticated Roblox owner in the backend;
they should not fetch every webhook and filter the result in the dashboard server.

### Queue safety

- Verify ER:LC signatures against the exact raw request bytes before storage.
- Deduplicate retried deliveries using a stable event ID or a signed-payload hash.
- Add configurable retention and per-webhook queue limits.
- Keep acknowledged events briefly for inspection, then remove them by retention.
- Record last received time, last poll time, pending count, and last delivery error.
- Redact ingest IDs, Poll tokens, authorization headers, and destination webhook
  credentials from logs and error responses.
- Add separate rate limits for ingestion, polling, management, and test events.

### Backend tests

Cover valid and invalid signatures, duplicate ingestion, pagination without gaps,
acknowledgement idempotency, token rotation, retention, queue limits, restart
persistence, and cross-account access denial. Add a contract fixture shared with
the SDK and dashboard tests.

## Workstream 2: LibertyJS 1.3

### Typed events

Export a `LibertyWebhookEvent` discriminated union for known events such as
`CustomCommand`, `EmergencyCall`, and `WebhookProbe`, plus an unknown-event member.
Keep the raw payload available. Add type guards so plain JavaScript and TypeScript
users can safely narrow events.

Do not invent fields the API does not guarantee. Build initial event types from
the backend contract and sanitized production fixtures.

### Poll API

Keep `webhook.events()` as a backward-compatible one-shot method and add:

- `webhook.listEvents({ cursor, limit, pendingOnly, signal })`
- `webhook.acknowledge(eventIds, { signal })`
- `webhook.watch({ interval, signal })` as an async iterable
- `webhook.status({ signal })`

`watch()` should fetch pages in order, yield each event once, and acknowledge an
event only after consumer code advances the iterator. It should apply bounded
backoff with jitter for transient failures, respect `Retry-After`, stop immediately
when aborted, and never put a Poll token in an error message.

### Command router

Add an SDK-owned command router on top of Poll events. The intended first-use
experience is:

```js
const erlc = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,
    WEBHOOK_ID: process.env.LIBERTYTOOLS_WEBHOOK_ID
});

erlc.commands.command("help", async context => {
    await context.reply("Need help? Join our support channel or run ;commands.");
}, {
    cooldown: 10_000
});

await erlc.commands.start();
```

Accept both `"help"` and `";help"` when registering, normalize the name, and reject
empty names or names containing whitespace. The ER:LC event already separates the
command name from its argument, so the prefix is a display and registration
convenience rather than something the SDK should expect in the event payload.

Each handler receives a typed context:

```ts
interface CommandContext {
    event: CustomCommandEvent;
    command: string;
    argument: string;
    args: string[];
    userId: string;
    serverId: string;
    reply(message: string): Promise<CommandResult>;
    announce(message: string): Promise<CommandResult>;
}
```

`argument` preserves the original text. `args` provides a documented parser with
quoted arguments, so `;warn Player "final warning"` is useful without every app
implementing its own parser.

`reply()` must target the player who triggered the event. The observed production
event contains `userId` but no username. Confirm whether ER:LC accepts a user ID in
the private-message command. If it requires a username, query `Players`, match the
ID, cache the result briefly, and return a clear `player_not_found` result if the
player left before the reply. Do not guess a username or message another player.

Also expose `commands.handle(event)` so applications receiving direct verified
webhooks can use the same router without starting the Poll loop. `commands.start()`
owns the Poll lifecycle; `commands.stop()` aborts waiting, prevents another poll,
and waits for active handlers to settle within a configurable shutdown timeout.

### Transport-independent commands

The command router must sit above event delivery. A registered handler should not
care whether its event arrived through Liberty Tools Poll mode, Liberty Tools Proxy
mode, or a direct ER:LC webhook.

```js
erlc.commands.command("help", context => context.reply("How can we help?"));
```

That same handler supports these transports:

- **Poll:** `commands.start()` requests queued events from Liberty Tools, normalizes
  them, and passes them to `commands.handle()`.
- **Direct ER:LC webhook:** the application gives the SDK the timestamp, signature,
  and exact raw body. LibertyJS verifies the official signature, parses the event,
  and passes it to `commands.handle()`.
- **Liberty Tools Proxy:** the application receives the forwarded request through
  an SDK-provided request handler or framework adapter. LibertyJS authenticates the
  forwarded request, normalizes it, and passes it to `commands.handle()`.
- **Manual:** tests and advanced applications can pass an already validated event
  directly to `commands.handle()`.

Provide transport helpers rather than embedding an HTTP framework in the command
router. The initial helpers should support the standard Fetch `Request`/`Response`
shape and Node.js request data. Express and other framework adapters can remain
small optional entry points later.

Easy mode is the ergonomic command API, not a fourth event format. It uses whichever
transport the developer configures. If the existing hosted Easy mode delivers an
event straight to Discord, no SDK process receives that event and SDK handlers
cannot run; users who want code handlers must select Poll, Proxy, or a direct ER:LC
webhook. A future dashboard rule builder can execute hosted Easy rules without an
SDK process.

Direct ER:LC requests must pass official signature verification before parsing.
Proxy requests must either preserve the verifiable original raw request and headers
or carry a separate Liberty Tools signature and timestamp. Do not accept arbitrary
unsigned JSON on a public SDK webhook handler.

### Router behavior and safeguards

- Match commands case-insensitively and preserve argument casing.
- Ignore non-`CustomCommand` events.
- Provide per-command, per-player cooldowns with remaining time in skipped results.
- Prevent overlapping polls and duplicate concurrent handling of the same event ID.
- Keep a bounded event-ID cache so repeated Poll responses do not rerun handlers.
- Process events in received order with configurable, bounded concurrency.
- Catch handler failures, report them through an `error` listener, and continue.
- Sanitize reply/announcement text for length and line breaks before constructing
  the ER:LC command.
- Never include the server key, webhook ID, or full request URL in errors.
- Do not automatically retry an ER:LC command after an ambiguous network timeout;
  the message may already have been sent.

The first release should include `command()`, `remove()`, `start()`, `stop()`,
`handle()`, `reply()`, and `announce()`. Aliases, permissions, command descriptions,
help-page generation, subcommands, and middleware can follow after the core has
been exercised by real servers.

### Command router tests

Use synthetic event fixtures and mocked fetch calls to cover registration with and
without `;`, exact matching, case normalization, argument parsing, ignored event
types, player lookup, replies, announcements, cooldown races, duplicate events,
handler errors, stop/abort behavior, invalid messages, and ambiguous timeouts.
Include an end-to-end SDK test where a `CustomCommand` Poll response causes exactly
one correctly formed private-message request.

### Request improvements

- Add request timeouts and `AbortSignal` support to all network methods.
- Export `isLibertyError()` and stable error codes.
- Include a request ID from the API in errors when available.
- Keep shared rate-limit handling, but avoid sleeping a cancelled request.
- Document CommonJS behavior explicitly; the package remains an ES module.

### SDK validation

Add tests for cursor paging, acknowledgement after successful handling, retry and
abort behavior, unknown events, token redaction, and backward compatibility. Run
runtime and strict type checks in CI on every pull request. Verify the packed npm
artifact before release.

## Future milestone: dashboard event control center

### Webhook overview

Replace the select-first layout with webhook cards showing:

- name and mode
- receiving, idle, or error status
- last event time and pending count
- destination health for Easy and Proxy modes
- copy buttons for the ER:LC URL and a ready-to-use LibertyJS snippet

Use the limit returned by `/api/webhooks`; remove the hard-coded client limit.
Explain Poll, Easy, and Proxy at the point where the user chooses a mode.

### Event inspector

For Poll webhooks, add a recent-events panel with manual refresh, optional live
refresh, type filters, timestamps, and expandable JSON. Paginate using the backend
cursor. The inspector must not acknowledge events automatically; make the pending
state visible and provide an explicit acknowledgement action for debugging.

Add a **Send test event** action that creates a clearly marked synthetic event.
This verifies dashboard-to-SDK flow without pretending an event came from ER:LC.

### Management and security

- Show the Poll token once at creation, then offer copy and rotate actions.
- Add delete with a confirmation naming the webhook.
- Validate Easy/Proxy destinations server-side, require HTTPS, and block loopback,
  link-local, and private-network targets to prevent server-side request forgery.
- Add CSRF/origin protection for session-authenticated mutations.
- Replace the default in-memory session store with the deployment's persistent
  store and configure secure-cookie behavior for the production proxy.
- Return consistent JSON errors and render nested error details cleanly.

### Dashboard tests

Extract the upstream API client and route handlers so they can be tested without
Roblox or the live service. Cover unauthenticated requests, ownership enforcement,
create/update/delete validation, upstream failures, session behavior, and the
dynamic webhook limit. Add a small browser-level test for the create-to-inspect
flow.

## Delivery order

1. Capture sanitized `CustomCommand` fixtures and confirm the ER:LC PM target syntax.
2. Implement event types, one-shot listing, and the command router against the
   current production Poll response.
3. Add router lifecycle, cooldown, player-resolution, deduplication, and failure
   tests, then verify the packed npm artifact.
4. Publish `@libertytools/libertyjs@1.3.0-beta.1` and test `;help` on a real server.
5. Locate the production backend repository and add cursor/acknowledgement routes
   without breaking the current endpoint.
6. Update the SDK beta to use acknowledgements when the backend supports them.
7. Release LibertyJS 1.3.0 after restart, duplicate-event, timeout, and load tests.
8. Build the visual dashboard rule builder as a later milestone using the proven
   SDK command concepts and event contract.

## Release acceptance checks

- A real ER:LC event appears in the dashboard and SDK within two poll intervals.
- Invalid signatures never enter the queue.
- Retried inbound deliveries produce one event.
- A consumer restart resumes from its cursor without gaps.
- Failed consumer handling leaves the event pending for another attempt.
- One Roblox account cannot list, read, rotate, update, or delete another account's
  webhook.
- Backend restart does not lose pending events.
- A `;help` event invokes its SDK handler and sends one private message to the
  player who triggered it.
- Repeated Poll responses cannot execute the same command event twice in one SDK
  process.
- Cooldowns remain correct when matching events arrive concurrently.
- Stopping the router ends polling without starting another request.
- Existing ingest URLs and `webhook.events()` continue to work during migration.
- Logs and errors contain no Poll token or destination webhook credential.

## Deliberate non-goals for this release

Do not add another SDK language, a general analytics platform, a dashboard rule
builder, arbitrary code execution, or a full workflow engine. The release succeeds
when a developer can reliably build commands such as `;help` with a few clear lines
of LibertyJS code.
