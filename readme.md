# Dev Server

## Required Dependencies

* **dotenv**

  * Used for ER:LC private server key
  * Optional: Express port for server

---

# Importing the Package

```js
import tools from "./src/index.js";
```

> Adjust the path depending on where the package is located.

---

# Functions

## `tools.createAPIData(array)`

### Example Usage

```js
tools.createAPIData([
    "Players",
    "Queue",
    {
        t: "Command",
        r: ":h test"
    }
]);
```

### Returns

```js
{
    query: "?Players=true&Queue=true",
    commands: [":h test"],
    invalid: {
        invalidParams: [],
        invalidCommands: []
    }
}
```

---

## Behavior

### Options

* Must match valid options exactly (case-sensitive)
* Invalid options are:

  * Logged to console
  * Added to `invalid.invalidParams`
  * Excluded from query

### Example Error

```
[createAPIData]: Option "Members" is not a valid option
```

---

### Commands

Commands must follow this structure:

```js
{
    t: "Command",
    r: ":h Hello!"
}
```

### Invalid Command Object

```
[createAPIData]: Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"
```

### Unsupported Command

```
[createAPIData]: Command ":tocar" is not supported
```

### Invalid Arguments

```
[createAPIData]: Command ":tp" requires 2 args
```

or (for string-ending commands):

```
[createAPIData]: Command ":pm" requires 2+ args
```

### Invalid Commands Tracking

Invalid commands are added to:

```js
invalid.invalidCommands
```

---

## `tools.getPrivateServerAPI(query)`

### Example Usage

```js
await tools.getPrivateServerAPI("?Players=true");
```

### Notes

* `query` is optional
* Automatically handles rate limits (waits and retries)
* Returns:

  * API response on success
  * Error object on failure

---

## Possible Errors

### Rate Limit (auto-retry triggered)

```
[getPrivateServerAPI]: You are currently being rate limited! Sending request in 30
```

### Invalid API Key (after 2 failures)

```js
{
    code: "forbidden",
    error: "[getPrivateServerAPI]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

### Missing API Key

```js
{
    code: "invalid_env",
    error: "[getPrivateServerAPI]: PRIVATE_SERVER_KEY was not provided in a .env file"
}
```

### API Error Response

```js
{
    code: "api-error",
    error: "[getPrivateServerAPI]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```

---

## `tools.sendPrivateServerCommand(command)`

### Example Usage

```js
await tools.sendPrivateServerCommand({
    command: ":h Hello there!"
});
```

---

## Requirements

* Must be a **single object**
* Must contain only:

```js
{ command: "..." }
```

---

## Validation Errors

### Invalid Object

```js
{
    code: "invalid_object",
    error: "[sendPrivateServerCommand]: You must include a valid object"
}
```

### Multiple Keys

```js
{
    code: "too_many_objects",
    error: "[sendPrivateServerCommand]: You may only send one command at a time"
}
```

### Invalid Key Name

```js
{
    code: "invalid_object",
    error: '[sendPrivateServerCommand]: Object key must start with "command"'
}
```

---

## Runtime Errors

### Rate Limit (auto-retry triggered)

```
[sendPrivateServerCommand]: You are currently being rate limited! Sending request in 30
```

### Invalid API Key

```js
{
    code: "forbidden",
    error: "[sendPrivateServerCommand]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
}
```

### Missing API Key

```js
{
    code: "invalid_env",
    error: "[sendPrivateServerCommand]: PRIVATE_SERVER_KEY was not provided in a .env file"
}
```

### API Error Response

```js
{
    code: "api-error",
    error: "[sendPrivateServerCommand]: Encountered an error while attempting to fetch <url>",
    apiResponse: { ... }
}
```