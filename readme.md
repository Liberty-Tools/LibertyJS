# LibertyJS

A lightweight SDK for the **ER:LC Private Server API**, designed to simplify requests, enforce rate limits, and provide structured error handling.

---

## Features

* Automatic **rate limit handling** (GET + POST)
* Built-in **API key validation**
* **403 fail-safe** (halts after repeated failures)
* Optional **webhook integration**
* Consistent, structured **error responses**
* Automatic **JSON handling for POST requests**

---

## Importing

```js
import LibertyJS from "./src/index.js";
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
| `PRIVATE_SERVER_API` | ❌        | Base API URL (defaults to PRC v2 API) |
| `WEBHOOK_URL`        | ❌        | Webhook base URL                      |
| `WEBHOOK_TOKEN`      | ⚠️       | Required if `WEBHOOK_URL` is provided |

---

# Methods

---

## `getPrivateServerAPI(query)`

Fetch data from the ER:LC Private Server API.

### Example

```js
const data = await LJS.getPrivateServerAPI("?Players=true");
```

---

### Behavior

* Automatically appends:

  ```
  /server
  ```
* `query` is optional
* Automatically waits if rate-limited
* Uses stored **GET rate limit state**

---

### Rate Limiting

If rate-limited:

```
[LibertyJS.getPrivateServerAPI]: You are currently being rate limited! Sending request in X seconds
```

The request will **pause and retry automatically**.

---

### Possible Errors

#### Forbidden (after 2 failures)

```js
{
    error: "forbidden",
    message: "[LibertyJS]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

---

#### Missing API Key

```js
{
    error: "invalid_env",
    message: "[LibertyJS]: SERVER_KEY was not provided in a .env file"
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

## `sendPrivateServerCommand(command)`

Send a command to the private server.

---

### Example

```js
await LJS.sendPrivateServerCommand({
    command: ":h Hello world!"
});
```

---

### Requirements

* Must be an **object**
* Must contain **exactly one key**
* That key must be `"command"`

---

### Validation Errors

#### Invalid Object

```js
{
    error: "invalid_object",
    message: "[LibertyJS.sendPrivateServerCommand]: You must include a valid object"
}
```

---

#### Too Many Keys

```js
{
    error: "too_many_objects",
    message: "[LibertyJS.sendPrivateServerCommand]: You may only send one command at a time"
}
```

---

#### Invalid Key

```js
{
    error: "invalid_object",
    message: '[LibertyJS.sendPrivateServerCommand]: Object key must start with "command"'
}
```

---

### Rate Limiting

```
[LibertyJS.sendPrivateServerCommand]: You are currently being rate limited! Sending request in X seconds
```

* Uses **POST rate limit bucket**
* Automatically waits before retrying

---

### API Errors

```js
{
    error: "api-error",
    message: "[LibertyJS]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
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

#### Webhook Not Enabled

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
    message: "[LibertyJS.fetchWebhookEvents]: You must provide a WEBHOOK_URL and/or a WEBHOOK_TOKEN in a .env file"
}
```

---

#### API Error

```js
{
    error: "api-error",
    message: "[LibertyJS.fetchWebhookEvents]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

# Internal Behavior

---

## Rate Limit System

The SDK tracks rate limits separately for GET and POST:

```js
this.rateLimits = {
    get: { limit, remaining, reset },
    post: { limit, remaining, reset }
};
```

### Details

* Uses response headers:

  * `X-RateLimit-Limit`
  * `X-RateLimit-Remaining`
  * `X-RateLimit-Reset`
* Automatically delays requests when:

  ```
  remaining === 0 && currentTime < reset
  ```
* Time is handled using **epoch seconds**

---

## Forbidden Protection

If the API returns `403` twice:

* `resStatus.forbiddenErrors` increments
* All future requests return:

```js
{
    error: "forbidden",
    message: "[LibertyJS]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

This prevents:

* Invalid key spam
* Unnecessary API load

---

## Request Handling (`#fetchAPI`)

Core internal request handler.

### Responsibilities

* Injects headers:

  * `server-key` (for PRC endpoints)
  * `Content-Type: application/json` (POST only)
* Stringifies body for POST requests (PRC only)
* Parses JSON responses
* Tracks rate limits
* Handles errors consistently

---

## Private Helpers

### `#wait(seconds)`

* Promise-based delay utility
* Used internally for rate limiting

---

## Notes

* Only PRC API requests receive:

  * Authentication headers
  * Rate limit tracking
* Non-PRC requests (like webhooks) are treated as standard fetch calls
* All methods return either:

  * **API data**
  * or a structured **error object**