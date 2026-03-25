# Dev Server

## Required Dependencies
- dotenv
    - Used for ER:LC private server key
    - Express port for server (Not required)

# How do you import the package?
Use the following command: `import tools from "./src/index.js";`

You may need to change the location of the import to where you have installed the package.

---
# Functions

## `tools.createAPIData(array)`
Expected function statement:
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

Returns:
```js
{ 
    query: '?Players=true&Staff=true', 
    commands: [ ':h test' ] 
}
```

If an invalid option is used like `"Members"` it will throw an error, and exclude it from the returned query. It will also throw an error for `"players"` as it is case-senstive.

Example Error: `[createAPIData]: Option "Members" is not a valid option`

### How to include commands
When using a command this function expects an object in the array shaped the example below:
```js
{
    t: "Command"
    r: ":h Hello!"
}
```

If an invalid object is provided like the examples below it will return this error:
`[createAPIData]: Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"`

Examples:
```js
{
    t: "message"
    r: "Hello!"
}
```
```js
{
    t: "Command"
    r: "h Hello!"
}
```

If a command doesn't exist this function will return `[createAPIData]: Command ":tocar" either doesn't exist or isn't supported`

If you provide invalid arguments for a command (ex: ":tp me") this function will return `[createAPIData]: Command ":tp" requires 2 args`

## `tools.getPrivateServerAPI(query)`
Expected function statement:
```js
await tools.getPrivateServerAPI("?Players=true");
```

If an error is encountered it will return `undefined` so make sure you have a console you can easily view to ensure everything is working correctly. If there is no error it will return the responce body recived from the API.

A query is **not** required as the API will still return information without a query.

### Example Errors
---
Rate Limit Error: `[getPrivateServerAPI]: You are currently being rate limited! Please try again in 30 seconds`

Invalid Key Error: `[getPrivateServerAPI]: Recieved a 403 error 2 times, suspending API calls as the server key may be invalid`

No API key provided: `[getPrivateServerAPI]: PRIVATE_SERVER_KEY was not provided in a .env file`

## `tools.sendPrivateServerCommand(command)`
Expected function statement:
```js
await tools.sendPrivateServerCommand({command: ":h Hello there!"});
```

If an error is encountered it will return `undefined` so make sure you have a console you can easily view to ensure everything is working correctly. If there is no error it will return the responce body recived from the API.

A command is expected to be in the shape of a sigular js object, if you provided more then one command in the object it will return `[sendPrivateServerCommand]: You may only send one command at a time` due to the API limits.

### Example Errors
---
Rate Limit Error: `[sendPrivateServerCommand]: You are currently being rate limited! Please try again in 30 seconds`

Invalid Key Error: `[sendPrivateServerCommand]: Recieved a 403 error 2 times, suspending API calls as the server key may be invalid`

No API key provided: `[sendPrivateServerCommand]: PRIVATE_SERVER_KEY was not provided in a .env file`