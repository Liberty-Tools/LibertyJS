import tools from "./src/index.js";

/*
console.log(await tools.createAPIData([
    "Players",
    {
        t: "Command",
        r: ":h hello hello"
    }
]));
*/

for (let i = 0; i !== 50; i++) console.log(await tools.getPrivateServerAPI());
//for (let i = 0; i !== 20; i++) await tools.sendPrivateServerCommand({command: ":logs"});