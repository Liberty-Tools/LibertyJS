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

## Optional Liberty Tools webhook relay

Webhooks created at [dash.libertytools.dev](https://dash.libertytools.dev/dashboard) work directly with LibertyJS. Copy either the webhook ID or the complete â€œWebhook URL for ERLCâ€ shown by the dashboard:

```js
const erlc = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,
    WEBHOOK_ID: process.env.LIBERTYTOOLS_WEBHOOK_ID
});

erlc.webhook.erlcUrl(); // URL to paste into ER:LC settings
await erlc.webhook.status();
await erlc.webhook.events();
```

The default relay base is `https://api.libertytools.dev/`. `WEBHOOK_URL` can override it for self-hosted deployments. `WEBHOOK_TOKEN` remains an alias for backward compatibility.

`webhook.events()` is intended for dashboard webhooks configured in Poll mode. Easy and Proxy modes deliver events to their configured destination instead. The relay is separate from direct ER:LC webhook signature verification through `webhook.verify()`.

## Testing

```bash
npm test
```
