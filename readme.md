# LibertyJS

A lightweight SDK for the **ER:LC Private Server API**, designed to simplify requests, enforce rate limits, and provide structured error handling.

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/YFjuXJcnVC)

---

## Features

* Automatic **rate limit handling** (GET + POST)
* Built-in **API key validation**
* **403 fail-safe** (halts after repeated failures)
* Optional **webhook integration**
* Structured **error responses**
* Automatic **JSON handling for POST requests**
* Built-in **command validation + argument checking**

---

## Install using npm
```bash
npm i @libertytools/libertyjs
```

## Importing

```js
import LibertyJS from "@libertytools/libertyjs";
```

---

## Initialization

```js
const LJS = new LibertyJS({
    SERVER_KEY: process.env.SERVER_KEY,
    PRIVATE_SERVER_API: "https://api.policeroleplay.community/v2/", // optional
    WEBHOOK_URL: process.env.WEBHOOK_URL, // optional
    WEBHOOK_TOKEN: process.env.WEBHOOK_TOKEN // required if WEBHOOK_URL is used
});
```

---

## Configuration Options

| Option               | Required | Description                           |
| -------------------- | -------- | ------------------------------------- |
| `SERVER_KEY`         | ✅        | ER:LC private server API key          |
| `PRIVATE_SERVER_API` | ❌        | Base API URL (defaults to PRC v2)     |
| `WEBHOOK_URL`        | ❌        | Webhook base URL                      |
| `WEBHOOK_TOKEN`      | ⚠️       | Required if `WEBHOOK_URL` is provided |

---

# Methods

---

## `getPrivateServerAPI(options, includeInvalid?)`

Fetch data from the ER:LC Private Server API.

### Example

```js
const data = await LJS.getPrivateServerAPI([
    "Players",
    "Staff"
]);
```

---

### Parameters

| Parameter        | Type       | Description                         |
| ---------------- | ---------- | ----------------------------------- |
| `options`        | `string[]` | List of data types to request       |
| `includeInvalid` | `boolean`  | Include invalid options in response |

---

### Valid Options

* Players
* Staff
* JoinLogs
* Queue
* KillLogs
* CommandLogs
* ModCalls
* EmergencyCalls
* Vehicles

---

### Behavior

* Automatically appends `/server`
* Builds query string internally
* Filters invalid options
* Waits automatically if rate-limited

---

### Example with Invalid Tracking

```js
const res = await LJS.getPrivateServerAPI(
    ["Players", "InvalidOption"],
    true
);

console.log(res);
/*
{
  data: {...},
  invalidOptions: ["InvalidOption"]
}
*/
```

---

### Errors

#### Invalid Input

```js
{
    error: "invalid_input",
    message: "[LibertyJS.getPrivateServerAPI]: Options must be an array"
}
```

---

#### Forbidden (after 2 failures)

```js
{
    error: "forbidden",
    message: "[LibertyJS]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

---

#### API Error

```js
{
    error: "api-error",
    message: "[LibertyJS]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

## `sendPrivateServerCommand(commands)`

Send one or more commands to the private server.

---

### Example

```js
const res = await LJS.sendPrivateServerCommand([
    ":h Hello world!",
    ":kick PlayerName Spamming"
]);
```

---

### Parameters

| Parameter  | Type       | Description              |
| ---------- | ---------- | ------------------------ |
| `commands` | `string[]` | Array of command strings |

---

### Behavior

* Validates:

  * Command existence
  * Argument count
* Ignores:

  * Invalid commands
  * Incorrect argument usage
* Sends commands **sequentially**
* Tracks success/failure per command

---

### Response

```js
{
  successes: 2,
  failures: 0,
  failureReasons: []
}
```

---

### Failure Example

```js
{
  successes: 1,
  failures: 1,
  failureReasons: [
    {
      command: ":kick Player",
      apiResponse: { ... }
    }
  ]
}
```

---

### Errors

#### Invalid Input

```js
{
    error: "invalid_input",
    message: "[LibertyJS.sendPrivateServerCommand]: Options must be an array"
}
```

#### Empty Array

```js
{
    error: "invalid_input",
    message: "[LibertyJS.sendPrivateServerCommand]: Options must have at least one item"
}
```

---

# Webhook API

> Webhooks are accessed via a **nested object**, not top-level methods.

---

## `webhook.status()`

Check webhook health.

### Example

```js
const res = await LJS.webhook.status();
```

---

### Errors

#### Webhook Disabled

```js
{
    error: "webhook_disabled",
    message: "[LibertyJS.webhook.status]: Webhook is not configured"
}
```

---

## `webhook.events()`

Fetch webhook events.

### Example

```js
const events = await LJS.webhook.events();
```

### Responce

Custom Command
```json
{
  "count": 1,
  "events": [
    {
      "_id": "",
      "webhookId": "",
      "event": "CustomCommand",
      "userId": "1", // Roblox userId of who ran a custom command
      "timestamp": 1774666018, // Unix timestamp in seconds
      "command": "cmds",
      "argument": "",
      "server": "",
      "createdAt": "2026-03-28T02:46:59.591Z"
    }
  ]
}
```

Emergency Call
```json
{
  "count": 1,
  "events": [
    {
      "_id": "",
      "webhookId": "",
      "event": "EmergencyCallStarted",
      "userId": "server",
      "timestamp": 1774666088, // Unix timestamp in seconds
      "players": [], // Roblox userIds of users responding to the call
      "caller": 1, // Roblox userId of who ran a custom command
      "description": "abc", // Postion description (caller made)
      "callNumber": 733,
      "team": "Police", // Team the call is directed to
      "position": [
        824.1,
        2444.3
      ],
      "positionDescriptor": "abc", // Postion description (caller made)
      "startedAt": 1774666088, // Unix timestamp in seconds
      "server": "",
      "createdAt": "2026-03-28T02:48:10.200Z"
    }
  ]
}
```

---

### Errors

#### Webhook Disabled

```js
{
    error: "webhook_disabled",
    message: "[LibertyJS.webhook.events]: Webhook is not configured"
}
```

---

# Internal Behavior

---

## Rate Limiting

Tracked separately for GET and POST:

```js
{
    get: { limit, remaining, reset },
    post: { limit, remaining, reset }
}
```

---

### Details

* Uses headers:

  * `X-RateLimit-Limit`
  * `X-RateLimit-Remaining`
  * `X-RateLimit-Reset`
* Automatically delays requests when:

```
remaining === 0 && currentTime < reset
```

* Logs:

```
[LibertyJS]: Rate limited (GET/POST). Waiting X seconds
```

---

## Forbidden Protection

After **2 consecutive `403` responses**:

* All future API calls are blocked
* Prevents invalid API key spam

---

## Request Handling (`#fetchAPI`)

Handles:

* Authentication headers (`server-key`)
* JSON parsing (safe fallback to `null`)
* Rate limit tracking
* Error normalization
* Automatic JSON stringification for POST bodies
