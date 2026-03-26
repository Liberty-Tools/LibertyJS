# Dev Package

A lightweight wrapper for the **ER:LC Private Server API**, designed to simplify requests, enforce rate limits, and provide structured error handling.

---

## Features

* Automatic **rate limit handling** (GET + POST)
* Built-in **API key validation**
* **403 fail-safe** (halts after repeated failures)
* Optional **webhook integration**
* Clean, predictable **error objects**

---

## Importing

```js
import LibertyTools from "./src/index.js";
```

---

## Initialization

```js
const tools = new LibertyTools({
    SERVER_KEY: process.env.SERVER_KEY,
    PRIVATE_SERVER_API: "https://api.policeroleplay.community/v2/", // optional
    WEBHOOK_URL: process.env.WEBHOOK_URL, // optional
    WEBHOOK_TOKEN: process.env.WEBHOOK_TOKEN // required if WEBHOOK_URL is used
});
```

---

## Configuration Options

| Option               | Required | Description                  |
| -------------------- | -------- | ---------------------------- |
| `SERVER_KEY`         | ✅        | ER:LC private server API key |
| `PRIVATE_SERVER_API` | ❌        | Base API URL                 |
| `WEBHOOK_URL`        | ❌        | Webhook base URL             |
| `WEBHOOK_TOKEN`      | ⚠️       | Required if webhook is used  |

---

# Methods

---

## `getPrivateServerAPI(query)`

Fetch data from the ER:LC Private Server API.

### Example

```js
const data = await tools.getPrivateServerAPI("?Players=true");
```

### Notes

* `query` is optional
* Automatically waits if rate-limited
* Uses stored GET rate limit state

---

### Rate Limit Handling

If limited:

```
[getPrivateServerAPI]: You are currently being rate limited! Sending request in X seconds
```

The request will **pause and retry automatically**.

---

### Possible Errors

#### Forbidden (after 2 failures)

```js
{
    error: "forbidden",
    message: "[fetchAPI]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

#### Missing API Key

```js
{
    error: "invalid_env",
    message: "[fetchAPI]: SERVER_KEY was not provided in a .env file"
}
```

#### API Error

```js
{
    error: "api-error",
    message: "[fetchAPI]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

## `sendPrivateServerCommand(command)`

Send a command to the private server.

### Example

```js
await tools.sendPrivateServerCommand({
    command: ":h Hello world!"
});
```

---

### Requirements

* Must be an object
* Must contain **only one key**
* Key must be `"command"`

---

### Validation Errors

#### Invalid Object

```js
{
    error: "invalid_object",
    message: "[sendPrivateServerCommand]: You must include a valid object"
}
```

#### Too Many Keys

```js
{
    error: "too_many_objects",
    message: "[sendPrivateServerCommand]: You may only send one command at a time"
}
```

#### Invalid Key

```js
{
    error: "invalid_object",
    message: '[sendPrivateServerCommand]: Object key must start with "command"'
}
```

---

### Rate Limiting

Same behavior as GET:

```
[sendPrivateServerCommand]: You are currently being rate limited! Sending request in X seconds
```

---

### API Errors

```js
{
    error: "api-error",
    message: "[fetchAPI]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

## `fetchWebhookEvents()`

Fetch events from your configured webhook.

---

### Example

```js
const events = await tools.fetchWebhookEvents();
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
    message: "[fetchWebhookEvents]: Webhook is not configured"
}
```

#### Missing Config

```js
{
    error: "invalid_env",
    message: "[fetchWebhookEvents]: You must provide a WEBHOOK_URL and/or a WEBHOOK_TOKEN in a .env file"
}
```

#### API Error

```js
{
    error: "api-error",
    message: "[fetchWebhookEvents]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

# Internal Behavior

---

## Rate Limit System

The package tracks:

```js
this.rateLimits = {
    get: { limit, remaining, reset },
    post: { limit, remaining, reset }
};
```

* Uses `X-RateLimit-*` headers
* Automatically delays requests when needed
* Time is handled using **epoch seconds**

---

## Forbidden Protection

If the API returns `403` twice:

* All future requests are blocked
* Prevents spam + invalid key abuse

---

## Private Helper Methods

### `#wait(seconds)`

* Internal delay utility
* Used for rate limiting

### `#fetchAPI(url, options)`

* Core request handler
* Injects headers
* Parses JSON
* Handles:

  * Errors
  * Rate limits
  * Auth