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

If an invalid option is used like `"Members"` it will throw an error, and exclude it from the returned query.

Example Error: `[createAPIData]: option "Members" is not a valid option`

### How to include commands
When using a command this function expects an object shaped the example below:
```js
{
    t: "Command"
    r: ":h Hello!"
}
```

If an invalid object is provided like the examples below it will return this error:
`[createAPIData] Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"`

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

If a command doesn't exist this function will return `[createAPIData]: command ":tocar" either doesn't exist or isn't supported`

If you provide invalid arguments for a command (ex: ":tp me") this function will return `[createAPIData]: command ":tp" requires 2 args`