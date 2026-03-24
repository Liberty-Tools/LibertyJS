import 'dotenv/config';

function getValidOptions() {
    return {
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
    };
}

function getValidCommands() {
    return {
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
}

async function createAPIData(j) {
    const v = getValidOptions();
    const vc = getValidCommands();

    if (!Array.isArray(j)) {
        console.error('[createAPIData]: You must provide an array');
        return;
    }

    let query = [];
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
                    if ((s.length-1) === commandArgs.length) {
                        commands.push(j[i].r);
                    } else {
                        console.error(`[createAPIData]: command "${String(s[0])}" requires ${commandArgs.length} args`);
                    }
                } else {
                    console.error(`[createAPIData]: command "${String(s[0])}" either doesn't exist or isn't supported`);
                }
            } 
            else console.error('[createAPIData]: Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"');
        } else {
            if (Object.keys(v).includes(j[i])) {
                // create query
                if (query.length === 0) query.push(`?${j[i]}=true`);
                else query.push(`&${j[i]}=true`);
            } else {
                // handle invalid
                if (!Object.keys(v).includes(j[i])) {
                    invalid.push(j[i]);
                    console.log(`[createAPIData]: option "${String(j[i])}" is not a valid option`);
                }
            }
        }
    }
    
    if (query.length !== 0) query = query.join("");

    return {
        query,
        commands
    };
}

// ----- API Fetchers -----

let getRateLimits = {
    limit: null,
    remaining: null,
    reset: null,
}

let postRateLimits = {
    limit: null,
    remaining: null,
    reset: null,
}

let resStatus = {
    forbiddenErrors: 0
}

async function getPrivateServerAPI(query) {
    const currentTime = (Date.now()) / 1000; // convert ms to seconds

    if (!process.env.PRIVATE_SERVER_API || !process.env.PRIVATE_SERVER_API) {
        console.error("[getPrivateServerAPI]: PRIVATE_SERVER_KEY and/or PRIVATE_SERVER_API where not provided in a .env file."); 
        return null;
    }
    if (resStatus.forbiddenErrors >= 2) {
        console.error("[getPrivateServerAPI]: Recieved a 403 error 2 times, suspending API calls as the server key may be invalid.");
        return null;
    }

    if (getRateLimits.reset === null && getRateLimits.remaining === null && getRateLimits.reset === null) {
        const url = process.env.PRIVATE_SERVER_API + query;
        const r = await fetch(url, {
            method: "GET",
            headers: {
                'server_key': process.env.PRIVATE_SERVER_KEY,
            }
        });

        const d = await r.json();

        if (r.status !== 200) {
            if (d?.error && d?.message) {
                console.error(`[getPrivateServerAPI]: Encounted an error while attempting to fetch ${url}. Error: ${d?.error} Reason: ${d?.message}`);
                return null;
            } else {
                console.error(`[getPrivateServerAPI]: Encounted an unknown problem. If this problem consists it may be an issue with the Private Server API. \n Recived: ${d}`);
                return null;
            }
        } else {
            getRateLimits.reset = r.headers.get("X-RateLimit-Reset");
            getRateLimits.limit = r.headers.get("X-RateLimit-Limit");
            getRateLimits.remaining = r.headers.get("X-RateLimit-Remaining");

            return d;
        }
    } else {

    }
    if (currentTime < getRateLimits.reset) { // being rate limited, wait for rate limit to reset

    }
}

async function sendPRCCommand(command) {
    if (query = null);
}

export default {
    createAPIData: async (j) => createAPIData(j),
    createAPIData: async (j) => createAPIData(j),
    createAPIData: async (j) => createAPIData(j),
    callAPI: async (o) => callAPI(o)
};