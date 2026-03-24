import tools from "./api.js";

console.log(await tools.callAPI([
    "Players",
    "Staff",
    "Members",
    {
        t: "Command",
        r: ":h hello"
    },
    {
        t: "Command",
        r: ":tp me"
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