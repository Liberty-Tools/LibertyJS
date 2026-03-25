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
        ":wanted": ["Player"],
        ":time": ["Number"],
        ":stopfire": [],
        ":respawn": ["Player"],
        ":tp": ["Player", "Player"],
        ":startnearfire": ["String"],
        ":jail": ["Player"],
        ":pt": ["Number"],
        ":h": ["String"],
        ":m": ["String"],
        ":pm": ["Player", "String"],
        ":refresh": ["Player"],
        ":bring": ["Player"],
        ":heal": ["Player"],
        ":kick": ["Player", "String"],
        ":startfire": ["String"],
        ":unwanted": ["Player"],
        ":prty": ["Number"],
        ":stopdumpsterfire": [],
        ":helper": ["Player/UserId"],
        ":shutdown": [],
        ":weather": ["String"],
        ":unmod": ["Player/UserId"],
        ":unloadlayout": ["String"],
        ":unban": ["String"],
        ":mod": ["Player/UserId"],
        ":ban": ["Player/UserId"],
        ":unhelper": ["Player/UserId"],
        ":log": ["String"],
        ":kill": ["Player"],
        ":unadmin": ["Player/UserId"],
        ":admin": ["Player/UserId"],
        ":loadlayout": ["String"]
    };
}

async function createAPIData(j) {
    const v = getValidOptions();
    const vc = getValidCommands();

    if (!Array.isArray(j)) {
        console.error('[createAPIData]: You must provide an array');
        return;
    }

    let params = [];
    let invalidParams = [];
    let invalidCommands = [];
    let commands = [];
    const objectKeys = Object.keys(v);
    for (let i = 0; i < j.length; i++) {
        if (typeof j[i] === "object") {
            // handle command stuff
            if (j[i]?.t === "Command" && typeof j[i]?.r === "string" && j[i].r.startsWith(":")) {
                const parts = j[i].r.trim().split(" ");
                const name = parts[0];
                const args = parts.slice(1);
                const schema = vc[name];

                if (!schema) {
                    console.error(`[createAPIData]: Command "${name}" is not supported`);
                    invalidCommands.push(j[i].r);
                    continue;
                }

                if ((schema.at(-1) === "String" && args.length >= schema.length) || (schema.at(-1) !== "String" && args.length === schema.length)) {
                    commands.push(j[i].r);
                } else {
                    console.error(`[createAPIData]: Command "${name}" requires ${schema.length}${schema.at(-1) === "String" ? "+" : ""} args`);
                    invalidCommands.push(j[i].r);
                }
            }
            else {
                console.error('[createAPIData]: Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"');
            }
        } else {
            if (objectKeys.includes(j[i])) {
                // create query
                params.push(`${j[i]}=true`);
            } else {
                // handle invalid
                invalidParams.push(j[i]);
                console.log(`[createAPIData]: Option "${String(j[i])}" is not a valid option`);
            }
        }
    }
    
    const query = params.length ? `?${params.join("&")}` : "";

    return {
        query,
        commands,
        invalid: {
            invalidParams,
            invalidCommands
        }
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

async function wait(seconds) {
    return new Promise(r => setTimeout(r, seconds * 1000));
}

async function getPrivateServerAPI(query) {
    async function f(q) {
        const url = (process.env.PRIVATE_SERVER_API ?? "https://api.policeroleplay.community/v2/") + "server" + (q ?? "");
        const r = await fetch(url, {
            method: "GET",
            headers: { 'server-key': process.env.PRIVATE_SERVER_KEY }
        });

        const d = await r.json();

        if (r.status !== 200) {
            if (r.status === 403) {
                resStatus.forbiddenErrors++;
            }
            return {
                code: "api-error",
                error: `[getPrivateServerAPI]: Encountered an error while attempting to fetch ${url}`,
                apiResponse: d
            }
        } else {
            getRateLimits.reset = Number(r.headers.get("X-RateLimit-Reset"));
            getRateLimits.limit = Number(r.headers.get("X-RateLimit-Limit"));
            getRateLimits.remaining = Number(r.headers.get("X-RateLimit-Remaining"));
            return d;
        }
    }

    const currentTime =  Math.floor(Date.now() / 1000); // convert ms to seconds

    if (!process.env.PRIVATE_SERVER_KEY) {
        return {
            code: "invalid_env",
            error: "[getPrivateServerAPI]: PRIVATE_SERVER_KEY was not provided in a .env file"
        };
    }
    if (resStatus.forbiddenErrors >= 2) {
        return {
            code: "forbidden",
            error: "[getPrivateServerAPI]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
        };
    }

    if ((currentTime < getRateLimits?.reset) && getRateLimits.remaining === 0) {
        const seconds = Math.max(0, getRateLimits.reset - currentTime);
        console.log(`[getPrivateServerAPI]: You are currently being rate limited! Sending request in ${seconds}`);
        await wait(seconds);
        return f(query);
    } else {
        return f(query);
    }
}

async function sendPrivateServerCommand(command) {
    async function f(b) {
        const url = (process.env.PRIVATE_SERVER_API ?? "https://api.policeroleplay.community/v2/") + "server/command"
        const r = await fetch(url, {
            method: "POST",
            headers: { 
                'server-key': process.env.PRIVATE_SERVER_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(b)
        });

        const d = await r.json();

        if (r.status !== 200) {
            if (r.status === 403) {
                resStatus.forbiddenErrors++;
            }
            return {
                code: "api-error",
                error: `[sendPrivateServerCommand]: Encountered an error while attempting to fetch ${url}`,
                apiResponse: d
            }
        } else {
            postRateLimits.reset = Number(r.headers.get("X-RateLimit-Reset"));
            postRateLimits.limit = Number(r.headers.get("X-RateLimit-Limit"));
            postRateLimits.remaining = Number(r.headers.get("X-RateLimit-Remaining"));
            return d;
        }
    }

    const currentTime =  Math.floor(Date.now() / 1000); // convert ms to seconds

    if (command === undefined || (command !== undefined && typeof command !== "object")) {
        return {
            code: "invalid_object",
            error: "[sendPrivateServerCommand]: You must include a valid object"
        };
    }

    if (Object.keys(command).length > 1) {
        return {
            code: "too_many_objects",
            error: "[sendPrivateServerCommand]: You may only send one command at a time",
        };
    } else {
        if (Object.keys(command)[0] !== "command") {
            return {
                code: "invalid_object",
                error: '[sendPrivateServerCommand]: Object key must start with "command"',
            };
        }
    }

    if (!process.env.PRIVATE_SERVER_KEY) {
        return {
            code: "invalid_env",
            error: "[sendPrivateServerCommand]: PRIVATE_SERVER_KEY was not provided in a .env file"
        };
    }
    if (resStatus.forbiddenErrors >= 2) {
        return {
            code: "forbidden",
            error: "[sendPrivateServerCommand]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
        };
    }

    if ((currentTime < postRateLimits?.reset) && postRateLimits.remaining === 0) {
        const seconds = Math.max(0, postRateLimits.reset - currentTime);
        console.log(`[sendPrivateServerCommand]: You are currently being rate limited! Sending request in ${seconds}`);
        await wait(seconds);
        return f(command);
    } else {
        return f(command);
    }
}

export default {
    createAPIData: async (j) => createAPIData(j),
    getValidOptions: () => getValidOptions(),
    getValidCommands: () => getValidCommands(),
    getPrivateServerAPI: async (q) => getPrivateServerAPI(q),
    sendPrivateServerCommand: async (b) => sendPrivateServerCommand(b),
};