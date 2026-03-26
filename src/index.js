export default class LibertyTools {
    constructor({ SERVER_KEY, PRIVATE_SERVER_API = "https://api.policeroleplay.community/v2/", WEBHOOK_URL, WEBHOOK_TOKEN  } = {}) {
        if (!SERVER_KEY) {
            throw new Error("[LibertyTools]: SERVER_KEY is required");
        }

        this.SERVER_KEY = SERVER_KEY;
        this.PRIVATE_SERVER_API = PRIVATE_SERVER_API;

        if (WEBHOOK_URL && !WEBHOOK_TOKEN) {
            throw new Error("[LibertyTools]: WEBHOOK_TOKEN is required if you are using a webhook");
        }

        this.useWebhook = !!WEBHOOK_URL;

        if (WEBHOOK_URL && WEBHOOK_TOKEN) {
            this.WEBHOOK_URL = WEBHOOK_URL;
            this.WEBHOOK_TOKEN = WEBHOOK_TOKEN;
        }

        this.rateLimits = {
            get: { limit: null, remaining: null, reset: null },
            post: { limit: null, remaining: null, reset: null }
        };

        this.resStatus = {
            forbiddenErrors: 0
        };
    }

    #wait(seconds) {
        return new Promise(r => setTimeout(r, seconds * 1000));
    }

    async #fetchAPI(url, o = {}) {
        if (!this.SERVER_KEY) {
            return {
                error: "invalid_env",
                message: "[fetchAPI]: SERVER_KEY was not provided in a .env file"
            };
        }
        if (this.resStatus.forbiddenErrors >= 2) {
            return {
                error: "forbidden",
                message: "[fetchAPI]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
            };
        }

        const isPRC = url.startsWith("https://api.policeroleplay.community/");
        
        const method = (o.method || "GET").toUpperCase();

        let headers = { ...(o.headers || {}) };

        // construct body for POST requests IF its a prc endpoint
        let body = o.body;
        if (method === "POST" && body !== undefined && isPRC) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(body);
        }

        if (isPRC) headers["server-key"] = this.SERVER_KEY;

        const res = await fetch(url, {
            ...o,
            method,
            headers,
            body
        });

        const d = await res.json();

        if (!res.ok) {
            if (res.status === 403) this.resStatus.forbiddenErrors++;
            return {
                error: "api-error",
                message: `[fetchAPI]: Encountered an error while attempting to fetch ${url}`,
                apiResponse: d
            }
        } else {
            if (isPRC) {
                const target = method === "GET"
                    ? this.rateLimits.get
                    : this.rateLimits.post;

                target.reset = Number(res.headers.get("X-RateLimit-Reset"));
                target.limit = Number(res.headers.get("X-RateLimit-Limit"));
                target.remaining = Number(res.headers.get("X-RateLimit-Remaining"));
            }
            return d;
        }
    }

    async getPrivateServerAPI(query) {
        const url = this.PRIVATE_SERVER_API + "server" + (query ?? "");

        const currentTime =  Math.floor(Date.now() / 1000); // convert ms to seconds

        const rl = this.rateLimits.get;
        if (rl.reset && rl.remaining === 0 && currentTime < rl.reset) {
            const seconds = Math.max(0, rl.reset - currentTime);
            console.log(`[getPrivateServerAPI]: You are currently being rate limited! Sending request in ${seconds} seconds`);
            await this.#wait(seconds);
        }
        return this.#fetchAPI(url);
    }

    async sendPrivateServerCommand(command) {
        const url = this.PRIVATE_SERVER_API + "server/command";

        const currentTime =  Math.floor(Date.now() / 1000); // convert ms to seconds

        if (!command || typeof command !== "object") {
            return {
                error: "invalid_object",
                message: "[sendPrivateServerCommand]: You must include a valid object"
            };
        }

        if (Object.keys(command).length > 1) {
            return {
                error: "too_many_objects",
                message: "[sendPrivateServerCommand]: You may only send one command at a time",
            };
        } else {
            if (Object.keys(command)[0] !== "command") {
                return {
                    error: "invalid_object",
                    message: '[sendPrivateServerCommand]: Object key must start with "command"',
                };
            }
        }

        const rl = this.rateLimits.post;
        if (rl.reset && rl.remaining === 0 && currentTime < rl.reset) {
            const seconds = Math.max(0, rl.reset - currentTime);
            console.log(`[sendPrivateServerCommand]: You are currently being rate limited! Sending request in ${seconds} seconds`);
            await this.#wait(seconds);
        }
        return this.#fetchAPI(url, { method: "POST", body: command });
    }

    async fetchWebhookEvents() {
        if (!this.useWebhook) {
            return {
                error: "webhook_disabled",
                message: "[fetchWebhookEvents]: Webhook is not configured"
            };
        }

        if (!this.WEBHOOK_URL || !this.WEBHOOK_TOKEN) {
            return {
                error: "invalid_env",
                message: "[fetchWebhookEvents]: You must provide a WEBHOOK_URL and/or a WEBHOOK_TOKEN in a .env file"
            };
        }

        const url = this.WEBHOOK_URL + "webhook/" + String(this.WEBHOOK_TOKEN) + "/events";
        const r = await fetch(url, {
            method: "GET"
        });

        const d = await r.json();

        if (r.ok) {
            return d;
        } else {
            return {
                error: "api-error",
                message: `[fetchWebhookEvents]: Encountered an error while attempting to fetch ${url}`,
                apiResponse: d
            };
        }
    }
}

// intergrate inside of api callers themselves maybe
/*
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
        return {
            error: "invalid_array",
            message: "[createAPIData]: You must provide an array"
        };
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
                    console.log(`[createAPIData]: Command "${name}" requires ${schema.length}${schema.at(-1) === "String" ? "+" : ""} args`);
                    invalidCommands.push(j[i].r);
                }
            }
            else {
                console.log('[createAPIData]: Invalid object data used in request, t must be "Command" and r must be a valid command starting with ":"');
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
            parms: invalidParams,
            commands: invalidCommands
        }
    };
}
*/