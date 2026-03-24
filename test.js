import tools from "./src/index.js";

console.log(await tools.createAPIData([
    "Players",
    "Staff",
    "Members",
    {
        t: "Command",
        r: ":h hello hello"
    },
    {
        t: "Command",
        r: ":tp me"
    },
    {
        t: "Command",
        r: ":tocar"
    },
    {
        t: "Command",
        r: "test"
    },
    {
        t: "test",
        r: "test"
    }
]));