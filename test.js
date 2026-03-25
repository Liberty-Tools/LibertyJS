import tools from "./src/index.js";

/*
console.log(await tools.createAPIData([
    "Players",
    "players",
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
*/

for (let i = 0; i !== 50; i++) console.log(await tools.getPrivateServerAPI());
//for (let i = 0; i !== 20; i++) await tools.sendPrivateServerCommand({command: ":logs"});