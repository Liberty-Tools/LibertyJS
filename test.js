import libertyTools from "./src/index.js";
import "dotenv/config";

const client = new libertyTools({
    SERVER_KEY: process.env.PRIVATE_SERVER_KEY,
});

await client.getPrivateServerAPI("?Players=true");

/*
console.log(await tools.createAPIData([
    "Players",
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
        r: ":tp player me"
    }
]));
*/

//for (let i = 0; i !== 50; i++) console.log(await tools.getPrivateServerAPI());
//for (let i = 0; i !== 20; i++) await tools.sendPrivateServerCommand({command: ":logs"});