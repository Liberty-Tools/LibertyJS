export default class LibertyJS {
    #SERVER_KEY;
    #PRIVATE_SERVER_API;
    #useWebhook;
    #WEBHOOK_URL;
    #WEBHOOK_TOKEN;
    #rateLimits;
    #resStatus;

    constructor({
        SERVER_KEY,
        PRIVATE_SERVER_API = "https://api.policeroleplay.community/v2/",
        WEBHOOK_URL,
        WEBHOOK_TOKEN
    } = {}) {
        if (!SERVER_KEY) {
            throw new Error("[LibertyJS]: SERVER_KEY is required");
        }

        this.#SERVER_KEY = SERVER_KEY;
        this.#PRIVATE_SERVER_API = PRIVATE_SERVER_API;

        if (WEBHOOK_URL && !WEBHOOK_TOKEN) {
            throw new Error("[LibertyJS]: WEBHOOK_TOKEN is required if you are using a webhook");
        }

        this.#useWebhook = Boolean(WEBHOOK_URL);

        if (WEBHOOK_URL && WEBHOOK_TOKEN) {
            this.#WEBHOOK_URL = WEBHOOK_URL;
            this.#WEBHOOK_TOKEN = WEBHOOK_TOKEN;
        }

        this.#rateLimits = {
            get: { limit: null, remaining: null, reset: null },
            post: { limit: null, remaining: null, reset: null }
        };

        this.#resStatus = {
            forbiddenErrors: 0
        };
    }

    #wait(seconds) {
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    }

    async #fetchAPI(url, options = {}) {
        if (!this.#SERVER_KEY) {
            return {
                error: "invalid_env",
                message: "[LibertyJS]: SERVER_KEY was not provided in a .env file"
            };
        }

        if (this.#resStatus.forbiddenErrors >= 2) {
            return {
                error: "forbidden",
                message: "[LibertyJS]: Received a 403 error 2 times, suspending API calls as the server key may be invalid"
            };
        }

        const isPRC = url.startsWith("https://api.policeroleplay.community/");
        const method = (options.method || "GET").toUpperCase();

        const headers = { ...(options.headers || {}) };

        let body = options.body;
        if (method === "POST" && body !== undefined) {
            headers["Content-Type"] = "application/json";
            body = typeof body === "string" ? body : JSON.stringify(body);
        }

        if (isPRC) {
            headers["server-key"] = this.#SERVER_KEY;
        }

        const currentTime = Math.floor(Date.now() / 1000);

        const handleRateLimit = async (rl) => {
            if (rl.reset && rl.remaining === 0 && currentTime < rl.reset) {
                const seconds = Math.max(0, rl.reset - currentTime);
                console.log(`[LibertyJS]: Rate limited (${method}). Waiting ${seconds}s`);
                await this.#wait(seconds);
            }
        };

        if (isPRC) {
            if (method === "GET") await handleRateLimit(this.#rateLimits.get);
            if (method === "POST") await handleRateLimit(this.#rateLimits.post);
        }

        const res = await fetch(url, {
            ...options,
            method,
            headers,
            body
        });

        let data;
        try {
            data = await res.json();
        } catch {
            data = null;
        }

        if (!res.ok) {
            if (res.status === 403 && isPRC) {
                this.#resStatus.forbiddenErrors++;
            }

            return {
                error: "api-error",
                message: `[LibertyJS]: Encountered an error while attempting to fetch ${url}`,
                apiResponse: data
            };
        }

        if (isPRC) {
            const target = method === "GET"
                ? this.#rateLimits.get
                : this.#rateLimits.post;

            target.reset = Number(res.headers.get("X-RateLimit-Reset"));
            target.limit = Number(res.headers.get("X-RateLimit-Limit"));
            target.remaining = Number(res.headers.get("X-RateLimit-Remaining"));
        }

        return data;
    }

    async getPrivateServerAPI(options = [], includeInvalid = false) {
        const valid = [
            "Players",
            "Staff",
            "JoinLogs",
            "Queue",
            "KillLogs",
            "CommandLogs",
            "ModCalls",
            "EmergencyCalls",
            "Vehicles"
        ];

        if (!Array.isArray(options)) {
            console.error("[LibertyJS.getPrivateServerAPI]: Options must be an array");
            return {
                error: "invalid_input",
                message: "[LibertyJS.getPrivateServerAPI]: Options must be an array"
            };
        }

        const params = [];
        const invalidOptions = [];

        for (const opt of options) {
            if (valid.includes(opt)) {
                params.push(`${opt}=true`);
            } else {
                console.log(`[LibertyJS]: Invalid option "${String(opt)}"`);
                invalidOptions.push(opt);
            }
        }

        const query = params.length ? `?${params.join("&")}` : "";
        const url = this.#PRIVATE_SERVER_API + "server" + query;

        if (!includeInvalid) {
            return await this.#fetchAPI(url);
        }

        return {
            data: await this.#fetchAPI(url),
            invalidOptions
        };
    }

    async sendPrivateServerCommand(options = []) {
        const url = this.#PRIVATE_SERVER_API + "server/command";

        const valid = {
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

        if (!Array.isArray(options)) {
            console.error("[LibertyJS.sendPrivateServerCommand]: Options must be an array");
            return {
                error: "invalid_input",
                message: "[LibertyJS.sendPrivateServerCommand]: Options must be an array"
            };
        }

        if (options.length === 0) {
            console.error("[LibertyJS.sendPrivateServerCommand]: Options must have at least one item");
            return {
                error: "invalid_input",
                message: "[LibertyJS.sendPrivateServerCommand]: Options must have at least one item"
            };
        }

        const commands = [];

        for (const cmd of options) {
            if (!cmd.startsWith(":")) continue;

            const parts = cmd.trim().split(" ");
            const name = parts[0];
            const args = parts.slice(1);
            const schema = valid[name];

            if (!schema) {
                console.error(`[LibertyJS]: Unsupported command "${name}"`);
                continue;
            }

            const validArgs =
                (schema.at(-1) === "String" && args.length >= schema.length) ||
                (schema.at(-1) !== "String" && args.length === schema.length);

            if (validArgs) {
                commands.push(cmd);
            } else {
                console.log(`[LibertyJS]: "${name}" requires ${schema.length}${schema.at(-1) === "String" ? "+" : ""} args`);
            }
        }

        let successes = 0;
        let failures = 0;
        const failureReasons = [];

        for (const command of commands) {
            const res = await this.#fetchAPI(url, {
                method: "POST",
                body: command
            });

            if (!res?.error) {
                successes++;
            } else {
                failures++;
                failureReasons.push({
                    command,
                    apiResponse: res.apiResponse
                });
            }
        }

        return { successes, failures, failureReasons };
    }

    async fetchWebhookEvents() {
        if (!this.#useWebhook) {
            return {
                error: "webhook_disabled",
                message: "[LibertyJS.fetchWebhookEvents]: Webhook is not configured"
            };
        }

        if (!this.#WEBHOOK_URL || !this.#WEBHOOK_TOKEN) {
            return {
                error: "invalid_env",
                message: "[LibertyJS.fetchWebhookEvents]: Missing WEBHOOK_URL or WEBHOOK_TOKEN"
            };
        }

        const url = `${this.#WEBHOOK_URL}webhook/${this.#WEBHOOK_TOKEN}/events`;

        return await this.#fetchAPI(url, { method: "GET" });
    }
}