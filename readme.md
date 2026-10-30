# LibertyJS

LibertyJS is a JavaScript SDK for building bots and integrations with the ERLC API. Use it to read server information, send remote commands, and handle custom commands such as `;help` from your own application.

LibertyJS runs in **Node.js**, including TypeScript projects. It does not run inside Roblox or in a browser. Your application must stay running to receive events.

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/YFjuXJcnVC)
[![npm](https://img.shields.io/npm/v/@libertytools/libertyjs)](https://www.npmjs.com/package/@libertytools/libertyjs)
[![downloads](https://img.shields.io/npm/dm/@libertytools/libertyjs)](https://www.npmjs.com/package/@libertytools/libertyjs)
[![Website](https://img.shields.io/badge/Website-LibertyTools-008b9a)](https://libertytools.dev/)
[![Dashboard](https://img.shields.io/badge/Dashboard-Open-008b9a)](https://dash.libertytools.dev/)

[Changelog](CHANGELOG.md)

## Choose what you need

| I want to… | Start here |
| --- | --- |
| Read server information or send a command from code | [Make your first API request](#make-your-first-api-request) |
| Run my own code when someone enters `;help` | [Handle custom commands with Poll](#handle-custom-commands-with-poll) |
| Receive events at a public URL | [Webhooks and forwarded events](#webhooks-and-forwarded-events) |
| Create simple commands without writing code | Use hosted commands in the [dashboard](https://dash.libertytools.dev/); the SDK is not required. |

You can use LibertyTools alongside Melonly or another service by adding a forwarding destination in the dashboard. That is a gateway feature, not an SDK setting. LibertyTools is not affiliated with those services or the ERLC team.

## Install

The package requires Node.js 18 or later and uses ES modules. Use a currently maintained Node.js release. In a new project folder, run:

```sh
npm init -y
npm pkg set type=module
npm install @libertytools/libertyjs
```

Keep credentials in environment variables. Do not put them in source code, public repositories, browser code, or logs. The examples below read `ERLC_SERVER_KEY` from your environment.

For example, in PowerShell:

```powershell
$env:ERLC_SERVER_KEY="your-server-key"
```

On macOS or Linux:

```sh
export ERLC_SERVER_KEY="your-server-key"
```

These set the variable for the current terminal session. A `.env` file is not loaded automatically by these examples; use your host's environment settings or configure an environment-file loader yourself.

## Make your first API request

Save this as `index.js`, then run `node index.js`:

```js
import LibertyJS from "@libertytools/libertyjs";

const erlc = new LibertyJS({ SERVER_KEY: process.env.ERLC_SERVER_KEY });
const response = await erlc.getPrivateServerAPI(["Players"]);

if (response?.error) {
    console.error(response.message);
} else {
    console.log(response);
}
```

Get the server key from your ERLC private-server settings. Your server needs ERLC API access. If ERLC requires approval for a public application, the server owner must authorize that application too.

Public applications serving multiple servers should also pass their own `GLOBAL_API_KEY`. This is separate from each server's key; do not ask users to supply your application's global key.

## Handle custom commands with Poll

Poll means your application asks LibertyTools for queued events. You do not need a public URL for your application.

1. Sign in to the [dashboard](https://dash.libertytools.dev/) and create a connection.
2. Copy its **ERLC webhook URL** into your ERLC server's Event Webhook setting.
3. Under **Outputs**, create a Poll client. Save its subscription ID and private token. The token is shown once; rotate it if lost or exposed.
4. Set `POLL_SUBSCRIPTION_ID` and `POLL_TOKEN` in the same environment as `ERLC_SERVER_KEY`.

Use the same environment-variable syntax shown above for those two additional values. Then replace `index.js` with:

```js
import LibertyJS from "@libertytools/libertyjs";

const erlc = new LibertyJS({
    SERVER_KEY: process.env.ERLC_SERVER_KEY,
    POLL_SUBSCRIPTION_ID: process.env.POLL_SUBSCRIPTION_ID,
    POLL_TOKEN: process.env.POLL_TOKEN
});

erlc.commands.command("help", async context => {
    const result = await context.reply("Need help? Ask a staff member.");
    if ("error" in result || result.failures > 0) {
        throw new Error("The reply could not be sent");
    }
});

erlc.commands.on("commandError", ({ error }) => console.error(error.message));
erlc.commands.on("pollError", ({ error }) => console.error(error.message));

async function shutdown() {
    try { await erlc.commands.stop(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await erlc.commands.start();
console.log("Listening for ;help. Press Ctrl+C to stop.");
```

Run `node index.js`, join your ERLC server, and enter `;help`. The SDK receives the command through Poll and asks ERLC to send you a private message.

`command("help", handler)` and `command(";help", handler)` register the same name. Registration does not configure the game's webhook setting for you.

### What a handler receives

| Value or method | Meaning |
| --- | --- |
| `context.command` | Lowercase command name, without `;`. |
| `context.argument` | Original argument text. |
| `context.args` | Parsed arguments. `Player "final warning"` becomes `["Player", "final warning"]`. |
| `context.userId` / `context.serverId` | IDs supplied by the normalized event. |
| `context.event` | Normalized event, including the original input in `raw`. |
| `context.reply(message)` | Resolve the triggering player and send a private message. |
| `context.announce(message)` | Send an ERLC `:h` message. |

Replies and announcements allow up to 200 characters and replace line breaks with spaces. They return a result; an API failure does not automatically throw. Check for `error` or a nonzero `failures` count. A player who has left may produce `player_not_found`.

### Poll behavior and retries

- `commands.start()` reads immediately, processes events in order, then waits two seconds between pages. Use `{ pollInterval: 5000 }` to change that delay in milliseconds; the minimum is 100.
- The router follows cursor pages and acknowledges successful, unhandled, ignored, duplicate, and cooldown events with string IDs. An acknowledgement tells the gateway that this Poll client is finished with the event.
- A thrown handler error leaves the event pending. Avoid repeating side effects on retry: an earlier action may have succeeded before a later action failed.
- Duplicate tracking is limited to the current process and a bounded cache. It is not a guarantee of exactly-once execution across restarts.
- `commands.stop()` aborts Poll requests and waits up to 10 seconds for active work. It cannot forcibly cancel your handler.

**Known 1.3.0 issue:** when a handler has a cooldown, a failed event may be acknowledged on its next delivery without retrying. Avoid cooldowns for handlers that depend on retrying failures until this is fixed. See the [roadmap](ROADMAP.md).

For repository examples, see [easy-commands.mjs](examples/easy-commands.mjs) and [quick-test.mjs](examples/quick-test.mjs). Both log failed actions instead of throwing for retry. After cloning the repository and installing dependencies, `npm run example:commands` starts the `;libertytest` example.

## API reference

### Constructor options

| Option | Purpose |
| --- | --- |
| `SERVER_KEY` | Required ERLC server API key. Currently required even for a Poll-only client. |
| `GLOBAL_API_KEY` | Your public application's global API key, when required. `AUTHORIZATION` is an alias. |
| `POLL_SUBSCRIPTION_ID`, `POLL_TOKEN` | Supply both for a current LibertyTools Poll client. |
| `LIBERTY_API_URL` | Poll API base URL; defaults to `https://api.libertytools.dev/`. |
| `WEBHOOK_INGEST_URL` | Optional ingest URL returned by `webhook.erlcUrl()`; it does not create a connection. |
| `PRIVATE_SERVER_API` | API base URL; defaults to `https://api.erlc.gg/v2/`. Automatic ERLC authentication and shared rate-limit handling apply only to the official API origin. |
| `MAX_RATE_LIMIT_RETRIES` | Retries after HTTP 429; defaults to 3. |
| `WEBHOOK_PUBLIC_KEY` | Override the built-in ERLC Ed25519 public key, for example in tests. |
| `FETCH` | Optional Fetch implementation; defaults to Node.js `fetch`. |

Legacy options `WEBHOOK_ID` and `WEBHOOK_TOKEN` identify an older relay connection; `WEBHOOK_URL` configures that relay's base URL. They do not replace a current private Poll token. Use a subscription ID and token for new clients.

### Server information

`getPrivateServerAPI()` returns base server information. Pass any of these extra fields:

```js
const response = await erlc.getPrivateServerAPI([
    "Players", "Staff", "JoinLogs", "Queue", "KillLogs",
    "CommandLogs", "ModCalls", "EmergencyCalls", "Vehicles"
]);
```

Duplicate fields are removed. Unknown fields are ignored. Pass `true` as the second argument to receive `{ data, invalidOptions }` instead of the response alone.

### Remote commands

```js
const result = await erlc.sendPrivateServerCommand([":h Hello everyone!"]);
if ("error" in result) {
    console.error(result.message);
} else {
    console.log(result.successes, result.failures);
    if (result.failures) console.error(result.failureReasons);
}
```

Commands are sent sequentially as `{ command: ":h Hello everyone!" }`. ERLC decides which commands are valid. A summary contains `successes`, `failures`, `failureReasons`, and `results`. An empty array or a non-array argument returns an input error.

### Read Poll events yourself

Use this for an event logger or another consumer that does not use the command router:

```js
const page = await erlc.webhook.listEvents({ limit: 50 });
if (page?.error) throw new Error(page.message);
if (!page || !Array.isArray(page.events)) throw new Error("Unexpected Poll response");

for (const event of page.events) {
    // Process the event successfully before acknowledging it.
    console.log(event.type, event.id);
    const result = await erlc.webhook.acknowledge([event.id]);
    if (result?.error) throw new Error(result.message);
}
// If page.hasMore is true, read the next page with:
// erlc.webhook.listEvents({ cursor: page.nextCursor, limit: 50 })
```

This snippet reads one page. For continuous custom-command handling, use `commands.start()`. Do not run two consumers on the same subscription unless you coordinate their acknowledgements. Create separate Poll clients for independent consumers.

`webhook.events()` is an alias for `listEvents()`. The page includes `events`, `nextCursor`, `hasMore`, `pendingCount`, `oldestPendingAt`, and `droppedCount`. Read `droppedCount` after reconnecting to spot lost pending events. The gateway caps subscriptions at 5,000 pending events with a 14-day expiry; storage eviction can also remove events earlier.

`listEvents()`, `events()`, `acknowledge()`, and `status()` accept an optional `signal` for cancellation. `limit` must be an integer from 1 to 100. `status()` checks gateway health, not whether your game is sending events. In Poll mode, `erlcUrl()` returns your supplied `WEBHOOK_INGEST_URL`, or `null` if none was supplied.

## Webhooks and forwarded events

Poll uses a token. Direct ERLC webhooks use an Ed25519 signature. LibertyTools signed forwards use a different authentication scheme. Do not treat these as interchangeable.

For a direct ERLC webhook, verify the exact raw bytes before processing the body:

```js
const valid = erlc.verifyWebhook({
    timestamp: request.headers["x-signature-timestamp"],
    signature: request.headers["x-signature-ed25519"],
    rawBody: request.rawBody
});
if (!valid) {
    // Return a 4xx response and do not process the request.
} else {
    // Parse, validate, and process the verified body here.
}
```

This illustrates the SDK call, not a complete HTTP server. Your framework must supply the original request bytes and headers. Do not verify a parsed and re-serialized body. `webhook.verify()` is an alias; timestamps more than five minutes from the host clock are rejected.

**Known 1.3.0 limitation:** `commands.handleWebhook()` does not unpack raw ERLC event batches. For now, verify the body, validate and split its `events` array, and normalize each event before calling `commands.handle(event)`. In particular, map raw `origin` to `data.userId` and the outer `server` to `serverId`. Prefer Poll for the ready-to-use command flow above.

For a LibertyTools signed forward, verify the gateway signature in your receiver before calling `commands.handle(event)` with its normalized event. LibertyJS 1.3.0 does not include that verifier. Never pass unauthenticated public request bodies directly to `handle()`.

## Errors and rate limits

HTTP and network failures normally return an object with `error` and `message`. HTTP errors also include `status`, `statusText`, `headers`, `apiResponse`, and optional `code` and `retryAfter` fields. Configuration mistakes and invalid method options can throw.

HTTP 429 responses trigger a bounded retry using `Retry-After`, then `retry_after` from the body or `X-RateLimit-Reset`. Other failures are not automatically retried. Instances sharing an ERLC key coordinate API requests within the same process; this does not coordinate separate processes or machines.

After three recognized ERLC authentication failures, the instance stops making requests. Correct the credentials and create a new instance. In 1.3.0 this also blocks its Poll calls. Server queries and remote commands have no configurable SDK timeout yet; see the [known issues](ROADMAP.md#fixes-to-prioritize).

## TypeScript

Declarations ship with the package. Use an ES module project with NodeNext resolution, or a bundler targeting Node.js. Install `@types/node` for Node.js globals.

```ts
import LibertyJS, { type ServerOption } from "@libertytools/libertyjs";
const key = process.env.ERLC_SERVER_KEY;
if (!key) throw new Error("ERLC_SERVER_KEY is required");
const erlc = new LibertyJS({ SERVER_KEY: key });
const fields: ServerOption[] = ["Players", "Staff"];
const response = await erlc.getPrivateServerAPI(fields);
if (typeof response === "object" && response !== null && "Name" in response) {
    console.log(response.Name);
}
```

Options, method signatures, command contexts, and result summaries are typed. Raw API and Poll responses are `unknown` because the SDK does not validate their schema. Narrow or validate them before reading fields. CommonJS projects can use dynamic `import()`; the package does not ship a separate CommonJS build.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| “SERVER_KEY is required” | Set the variable in the terminal or host that runs your process. A `.env` file alone is not enough. |
| No custom-command events | Check the ERLC webhook URL, connection status, subscription ID, and Poll token. Keep your bot running. |
| Events arrive but replies fail | Inspect `reply()` results, server-key validity, public-app authorization, and whether the triggering player is still in-game. |
| HTTP 401 or 403 | Check credentials and restrictions. The ingest URL is not a Poll credential. |
| Handler runs again after restart | Duplicate tracking is in memory. Store your own processed-event IDs if repeated side effects would be harmful. |
| Connection is suspended | Check the dashboard restriction message; retrying cannot override an admin restriction. |

For help, use the [support Discord](https://discord.gg/YFjuXJcnVC). Report vulnerabilities privately using [SECURITY.md](SECURITY.md). To contribute or run checks, see [CONTRIBUTING.md](CONTRIBUTING.md).
