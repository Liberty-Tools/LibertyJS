# LibertyJS

A lightweight Node.js SDK for the [ER:LC Private Server API v2](https://apidocs.erlc.gg/).

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/YFjuXJcnVC)
[![npm](https://img.shields.io/npm/v/@libertytools/libertyjs)](https://www.npmjs.com/package/@libertytools/libertyjs)
[![downloads](https://img.shields.io/npm/dm/@libertytools/libertyjs)](https://www.npmjs.com/package/@libertytools/libertyjs)

## Features

- All ER:LC v2 server-information query fields
- API-compliant remote command requests
- Optional global API key support for public applications
- Bucket-aware rate-limit tracking and automatic `429` retries
- Structured HTTP, API, and network errors
- Official Ed25519 event-webhook signature verification
- Optional compatibility with the Liberty Tools webhook relay

## Installation

```bash
npm install @libertytools/libertyjs
```

LibertyJS requires Node.js 18 or later.

## TypeScript

TypeScript declarations are included; the SDK runtime remains JavaScript. Use an
ES module project (`"type": "module"` in `package.json`) with NodeNext resolution,
or a bundler configured for a Node.js target. Install `@types/node` for Node.js
globals. The SDK requires Node.js and is not a browser SDK.

```ts
import LibertyJS, { type ServerOption } from "@libertytools/libertyjs";

const serverKey = process.env.SERVER_KEY;
if (!serverKey) throw new Error("SERVER_KEY is required");

const erlc = new LibertyJS({ SERVER_KEY: serverKey });
const fields: ServerOption[] = ["Players", "Staff"];
const response = await erlc.getPrivateServerAPI(fields);

// Responses are unvalidated JSON and may also contain SDK errors or be null.
if (typeof response === "object" && response !== null) {
    if ("error" in response) {
        console.error(response.error);
    } else if ("Name" in response && typeof response.Name === "string") {
        console.log(response.Name);
    }
}
```

Constructor options, query names, command summaries, webhook verification inputs,
and exported SDK error types are declared. Raw API/relay payloads are `unknown`:
validate them against your application's expected schema before use. The types
do not promise response fields that the SDK does not validate. Query names are
checked at compile time; JavaScript callers still receive the existing behavior
of ignoring invalid options.

`getPrivateServerAPI(fields, true)` returns typed `data` and `invalidOptions`
properties. `sendPrivateServerCommand()` returns a command summary or an input
error; check `"error" in result` before reading summary counts.

## Initialization

```js
import LibertyJS from "@libertytools/libertyjs";

const erlc = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,

    // Required for public applications serving multiple ER:LC servers.
    GLOBAL_API_KEY: process.env.ERLC_GLOBAL_API_KEY,

    // Optional; defaults to https://api.erlc.gg/v2/
    PRIVATE_SERVER_API: "https://api.erlc.gg/v2/",

    // Optional; defaults to 3 retries after HTTP 429 responses.
    MAX_RATE_LIMIT_RETRIES: 3,

    // Optional Liberty Tools dashboard webhook ID or full ER:LC webhook URL.
    WEBHOOK_ID: process.env.LIBERTYTOOLS_WEBHOOK_ID
});
```

`AUTHORIZATION` is accepted as an alias for `GLOBAL_API_KEY`.

## Fetch server information

The base server fields are always returned. Pass any combination of the nine optional v2 fields:

```js
const server = await erlc.getPrivateServerAPI([
    "Players",
    "Staff",
    "JoinLogs",
    "Queue",
    "KillLogs",
    "CommandLogs",
    "ModCalls",
    "EmergencyCalls",
    "Vehicles"
]);
```

Invalid options are ignored. To receive them alongside the API response:

```js
const { data, invalidOptions } = await erlc.getPrivateServerAPI(
    ["Players", "NotARealField"],
    true
);
```

Duplicate options are automatically removed so the API does not reject the request for duplicate query parameters.

## Run remote commands

```js
const result = await erlc.sendPrivateServerCommand([
    ":h Hello world!",
    ":kick PlayerName Spamming"
]);
```

Each command is sent sequentially as the API-required JSON object:

```json
{ "command": ":h Hello world!" }
```

LibertyJS intentionally does not maintain a command allowlist. ER:LC is the authoritative validator, so newly added commands remain usable without an SDK release.

The result includes aggregate counts and each API response:

```js
{
    successes: 2,
    failures: 0,
    failureReasons: [],
    results: [
        { command: ":h Hello world!", response: { message: "Success" } }
    ]
}
```

## Errors

API failures are returned as structured objects rather than thrown:

```js
{
    error: "api-error", // or "rate-limited" / "network-error"
    message: "...",
    status: 403,
    statusText: "Forbidden",
    code: 2002,
    headers: {},
    apiResponse: { code: 2002, message: "..." }
}
```

When ER:LC returns `429`, LibertyJS waits for `Retry-After` (falling back to `retry_after` or `X-RateLimit-Reset`) and retries up to `MAX_RATE_LIMIT_RETRIES` times.

## Official ER:LC event webhooks

ER:LC signs `timestamp + raw_body` with Ed25519. Pass the exact raw request bytes; do not parse and re-serialize the JSON before verification.

```js
const valid = erlc.webhook.verify({
    timestamp: request.headers["x-signature-timestamp"],
    signature: request.headers["x-signature-ed25519"],
    rawBody: request.rawBody // Buffer or Uint8Array
});

if (!valid) {
    // Return a 4xx response.
}
```

The official public key is built in and exported as `ERLC_WEBHOOK_PUBLIC_KEY`. `verifyWebhook(...)` is also available directly on the SDK instance.

## Liberty Tools dashboard webhooks

Webhooks created at [dash.libertytools.dev](https://dash.libertytools.dev/dashboard) work directly with LibertyJS.

### Dashboard setup

1. Sign in to the Liberty Tools dashboard with Roblox OAuth.
2. Create a webhook and choose Poll, Easy, or Proxy mode.
3. Copy the dashboard's **Webhook URL for ERLC** into the Event Webhook field in your ER:LC private-server settings.
4. Copy either the webhook ID or that complete URL into your application's `LIBERTYTOOLS_WEBHOOK_ID` environment variable.
5. Initialize LibertyJS as shown below.

Treat the webhook ID like a credential. Anyone who obtains a Poll-mode ID may be able to request its stored events.

```env
SERVER_KEY=your-erlc-server-key
LIBERTYTOOLS_WEBHOOK_ID=your-dashboard-webhook-id
```

```js
import LibertyJS from "@libertytools/libertyjs";

const erlc = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,
    WEBHOOK_ID: process.env.LIBERTYTOOLS_WEBHOOK_ID
});

// This is the URL that belongs in the ER:LC Event Webhook setting.
console.log(erlc.webhook.erlcUrl());

// Checks whether the Liberty Tools relay service is available.
const status = await erlc.webhook.status();
```

`WEBHOOK_ID` accepts either of these values:

```text
abc123
https://api.libertytools.dev/webhook/abc123
```

### Choosing a dashboard mode

| Mode | Delivery behavior | LibertyJS usage |
| --- | --- | --- |
| Poll | Liberty Tools stores events until the application requests them. | Call `webhook.events()`. |
| Easy | Liberty Tools formats and sends events to the destination configured in the dashboard. | No polling is required. |
| Proxy | Liberty Tools forwards events to the destination configured in the dashboard. | No polling is required. |

### Polling events

Only use `webhook.events()` or its clearer alias `webhook.listEvents()` with a
Poll-mode dashboard webhook:

```js
const response = await erlc.webhook.events();

if (response?.error) {
    console.error(response.status, response.apiResponse);
} else {
    for (const event of response.events ?? []) {
        console.log(event.event, event);
    }
}
```

The response contains `count` and `events`. Current event types include custom in-game commands and emergency calls.

## Easy command handlers

LibertyJS can poll a Liberty Tools Poll-mode webhook and route ER:LC custom-command
events to small handlers. Registering `help` or `;help` is equivalent:

```js
const erlc = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,
    WEBHOOK_ID: process.env.LIBERTYTOOLS_WEBHOOK_ID
});

erlc.commands.command("help", async context => {
    await context.reply("Need help? Join our support channel or run ;commands.");
}, {
    // Applied separately to each player.
    cooldown: 10_000
});

erlc.commands.on("commandError", ({ command, error }) => {
    console.error(`Command ${command} failed:`, error);
});

await erlc.commands.start();
```

A complete runnable version is available in `examples/easy-commands.mjs`.

`commands.start()` performs an immediate Poll request, handles returned events in
order, then waits two seconds before polling again. It prevents overlapping Poll
requests and ignores event IDs it has already handled in the current process.

Stop gracefully during application shutdown:

```js
process.once("SIGTERM", async () => {
    await erlc.commands.stop();
});
```

The handler context includes the normalized command, raw argument text, parsed
arguments, user ID, server ID, original event, and two response helpers:

```js
erlc.commands.command("warn", async context => {
    console.log(context.argument); // Player "final warning"
    console.log(context.args);     // ["Player", "final warning"]

    await context.reply("Your warning was received.");
    await context.announce("A warning was submitted.");
});
```

`reply()` resolves the triggering user ID against the current ER:LC player list
before constructing a private-message command. If the player has left, it returns
`{ error: "player_not_found", ... }` and sends nothing. Messages are limited to
200 characters and line breaks are replaced with spaces.

For a direct official ER:LC webhook, pass the exact signed request bytes to the
same router. The handler runs only after signature verification:

```js
const result = await erlc.commands.handleWebhook({
    timestamp: request.headers["x-signature-timestamp"],
    signature: request.headers["x-signature-ed25519"],
    rawBody: request.rawBody
});
```

Applications receiving an already authenticated Proxy event can call
`erlc.commands.handle(event)`. Do not pass untrusted public request bodies directly
to `handle()`; authenticate the Proxy request first. Hosted Easy-mode delivery does
not run SDK handlers unless it delivers an authenticated event to the application.

Use `pollError`, `handled`, `unhandled`, `cooldown`, and `commandError` listeners
for application logging and metrics. A handler failure does not stop other commands.

### Relay configuration options

| Option | Required | Description |
| --- | --- | --- |
| `WEBHOOK_ID` | Yes for relay methods | Dashboard webhook ID or complete ER:LC webhook URL. |
| `WEBHOOK_URL` | No | Relay base URL; defaults to `https://api.libertytools.dev/`. Use this for a self-hosted relay. |
| `WEBHOOK_TOKEN` | No | Backward-compatible alias for `WEBHOOK_ID`. |

Do not confuse the dashboard relay with direct webhook verification:

- Use `webhook.events()` for Liberty Tools Poll mode.
- Use `webhook.verify()` when your own application directly receives signed POST requests from ER:LC.
- Easy and Proxy modes deliver to the destination configured in the dashboard and do not need `webhook.events()`.

## Testing

```bash
npm test
```

For contributor checks, install development dependencies with `npm ci`, then run
`npm run check`. This runs the runtime suite and strict TypeScript consumer checks
using both NodeNext and Bundler module resolution. Type checks make no API calls.
