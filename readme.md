# LibertyJS

A lightweight SDK for the **ER:LC Private Server API**, designed to simplify requests, enforce rate limits, and provide structured error handling.

---

## Features

- Automatic **rate limit handling** (GET + POST)
- Built-in **API key validation**
- **403 fail-safe** (halts after repeated failures)
- Optional **webhook integration**
- Structured **error responses**
- Automatic **JSON handling for POST requests**

---

## Importing

```js
import LibertyJS from "libertyjs";
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

| Option               | Required | Description                       |
| -------------------- | -------- | --------------------------------- |
| `SERVER_KEY`         | ✅        | ER:LC private server API key      |
| `PRIVATE_SERVER_API` | ❌        | Base API URL (defaults to PRC v2) |
| `WEBHOOK_URL`        | ❌        | Webhook base URL                  |
| `WEBHOOK_TOKEN`      | ⚠️       | Required if `WEBHOOK_URL` is set  |

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

| Parameter        | Type       | Description                           |
| ---------------- | ---------- | ------------------------------------- |
| `options`        | `string[]` | List of data types to request         |
| `includeInvalid` | `boolean`  | Return invalid options alongside data |

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

console.log(res);
/*
{
  successes: 2,
  failures: 0,
  failureReasons: []
}
*/
```

---

### Parameters

| Parameter  | Type       | Description              |
| ---------- | ---------- | ------------------------ |
| `commands` | `string[]` | Array of command strings |

---

### Behavior

* Validates supported commands
* Validates argument count
* Ignores invalid commands
* Sends commands sequentially
* Tracks success/failure per command

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

## `fetchWebhookEvents()`

Fetch events from your configured webhook.

---

### Example

```js
const events = await LJS.fetchWebhookEvents();
```

---

### Requirements

* `WEBHOOK_URL` must be set
* `WEBHOOK_TOKEN` must be set

---

### Errors

#### Webhook Disabled

```js
{
    error: "webhook_disabled",
    message: "[LibertyJS.fetchWebhookEvents]: Webhook is not configured"
}
```

---

#### Missing Config

```js
{
    error: "invalid_env",
    message: "[LibertyJS.fetchWebhookEvents]: Missing WEBHOOK_URL or WEBHOOK_TOKEN"
}
```

---

# Internal Behavior

---

## Rate Limiting

The SDK tracks rate limits separately:

```js
{
    get: { limit, remaining, reset },
    post: { limit, remaining, reset }
}
```

### Details

* Uses headers:

  * `X-RateLimit-Limit`
  * `X-RateLimit-Remaining`
  * `X-RateLimit-Reset`
* Automatically delays requests when:

  ```
  remaining === 0 && currentTime < reset
  ```

---

## Forbidden Protection

After 2 consecutive `403` responses:

* All future requests are blocked
* Prevents invalid API key spam

---

## Request Handling (`#fetchAPI`)

Handles:

* Authentication headers
* JSON parsing
* Rate limit tracking
* Error normalization

---

## Notes

* Only PRC endpoints use:

  * API key auth
  * rate limit tracking
* Webhook requests are treated as standard fetch calls
* All methods return:

  * API data
  * OR structured error objects
