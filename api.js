import 'dotenv/config';
import 'express';

async function callAPI(j) {
    /*  expected request:
    
        callAPI([
            "Players",
            "Queue",
            {
                "t": "Command",
                "r": ":h test"
            }
        ]);
    */
    const v = {
        "Players": "Boolean",
        "Staff": "Boolean",
        "JoinLogs": "Boolean",
        "Queue": "Boolean",
        "KillLogs": "Boolean",
        "CommandLogs": "Boolean",
        "ModCalls": "Boolean",
        "EmergencyCalls": "Boolean",
        "Vehicles": "Boolean",
        "Command": "Query"
    }

    const vc = {
        ":wanted": "[Player]",
        ":time": "[Number]",
        ":stopfire": null,
        ":respawn": "[Player]",
        ":tp": "[Player][Player]",
        ":startnearfire": "[String]",
        ":jail": "[Player]",
        ":pt": "[Number]",
        ":h": "[String]",
        ":m": "[String]",
        ":pm": "[Player][String]",
        ":refresh": "[Player]",
        ":bring": "[Player]",
        ":heal": "[Player]",
        ":kick": "[Player][String]",
        ":startfire": "[String]",
        ":unwanted": "[Player]",
        ":prty": "[Number]",
        ":stopdumpsterfire": null,
        ":helper": "[Player/UserId]",
        ":shutdown": null,
        ":weather": "[String]",
        ":unmod": "[Player/UserId]",
        ":unloadlayout": "[String]",
        ":unban": "[String]",
        ":mod": "[Player/UserId]",
        ":ban": "[Player/UserId]",
        ":unhelper": "[Player/UserId]",
        ":log": "[String]",
        ":kill": "[Player]",
        ":unadmin": "[Player/UserId]",
        ":admin": "[Player/UserId]",
        ":loadlayout": "[String]"
    };

    if (!Array.isArray(j)) {
        console.error("[callAPI]: You must provide an array");
        return;
    }

    let options = [];
    let invalid = [];
    let commands = [];
    for (let i = 0; i < j.length; i++) {
        if (typeof j[i] === "object") {
            // handle command stuff
            if (j[i]?.t === "Command" && typeof j[i]?.r === "string" && String(j[i]?.r).startsWith(":"))  {
                const s = String(j[i].r).split(' ');
                if (vc[s[0]]) {
                    const command = vc[s[0]];
                    const commandArgs = command ? command.match(/\[[^\]]+\]/g) : [];
                    if ((s.length-1) === commandArgs.length) { // no prams
                        commands.push(j[i].r);
                    } else {
                        console.error("[callAPI]: command", s[0], "requires", commandArgs.length, "args");
                    }
                } else {
                    console.error("[callAPI]: command", s[0], "either doesn't exist or isn't supported");
                }
            }
            else console.error('Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":", skipping...');
        } else {
            if (Object.keys(v).includes(j[i])) {
                // create query
                if (options.length === 0) options.push(`?${j[i]}=true`);
                else options.push(`&${j[i]}=true`);
            } else {
                // handle invalid
                if (!Object.keys(v).includes(j[i])) {
                    invalid.push(j[i]);
                    console.log("[callAPI]: option", j[i], "is not a valid option");
                }
            }
        }
    }
    
    if (options.length !== 0) options = options.join("");


    return {
        options,
        commands
    };

    if (options.length !== 0) {
        const r = await fetch("https://api.policeroleplay.community/v2/server", {
            method: "GET",
            headers: {
                'Authorization': 'Bearer YOUR_TOKEN_HERE',
            }
            
        });
    }
    const r = await fetch("https://api.policeroleplay.community/v2/server", {
        method: "GET",
        
    });

    if (r.status === 403) {
        return {
            "status": 403,
            "error": "Invalid API Key."
        }
    }
}

async function runServer() {
    const app = express()
    const port = 3000

    app.get('/', (req, res) => {
    res.send('Hello World!')
    })

    app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
    })
}

export default {
  callAPI: async (j) => callAPI(j),
  runServer: async (o) => runServer(o)
};