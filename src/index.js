import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { CommandRouter } from "./commands.js";

const DEFAULT_API_URL = "https://api.erlc.gg/v2/";
const DEFAULT_WEBHOOK_RELAY_URL = "https://api.libertytools.dev/";
const ERLC_WEBHOOK_PUBLIC_KEY =
    "MCowBQYDK2VwAyEAjSICb9pp0kHizGQtdG8ySWsDChfGqi+gyFCttigBNOA=";
const VALID_SERVER_OPTIONS = new Set([
    "Players",
    "Staff",
    "JoinLogs",
    "Queue",
    "KillLogs",
    "CommandLogs",
    "ModCalls",
    "EmergencyCalls",
    "Vehicles"
]);
const SHARED_REQUEST_STATES = new Map();

function createRequestState() {
    return {
        rateLimits: new Map(),
        routeBuckets: new Map(),
        requestQueue: Promise.resolve()
    };
}

export default class LibertyJS {
    #SERVER_KEY;
    #GLOBAL_API_KEY;
    #PRIVATE_SERVER_API;
    #useWebhookRelay;
    #WEBHOOK_URL;
    #WEBHOOK_TOKEN;
    #WEBHOOK_PUBLIC_KEY;
    #fetch;
    #maxRateLimitRetries;
    #requestState;
    #resStatus = { forbiddenErrors: 0 };
    commands;

    constructor({
        SERVER_KEY,
        GLOBAL_API_KEY,
        AUTHORIZATION,
        PRIVATE_SERVER_API = DEFAULT_API_URL,
        WEBHOOK_URL,
        WEBHOOK_TOKEN,
        WEBHOOK_ID,
        WEBHOOK_PUBLIC_KEY = ERLC_WEBHOOK_PUBLIC_KEY,
        MAX_RATE_LIMIT_RETRIES = 3,
        FETCH = globalThis.fetch
    } = {}) {
        if (!SERVER_KEY || typeof SERVER_KEY !== "string") {
            throw new Error("[LibertyJS]: SERVER_KEY is required");
        }
        if (GLOBAL_API_KEY && AUTHORIZATION && GLOBAL_API_KEY !== AUTHORIZATION) {
            throw new Error("[LibertyJS]: GLOBAL_API_KEY and AUTHORIZATION must match when both are provided");
        }
        if (typeof FETCH !== "function") {
            throw new Error("[LibertyJS]: A Fetch API implementation is required");
        }
        if (!Number.isInteger(MAX_RATE_LIMIT_RETRIES) || MAX_RATE_LIMIT_RETRIES < 0) {
            throw new Error("[LibertyJS]: MAX_RATE_LIMIT_RETRIES must be a non-negative integer");
        }
        const webhookToken = this.#extractWebhookId(WEBHOOK_ID || WEBHOOK_TOKEN);
        if (WEBHOOK_ID && WEBHOOK_TOKEN && this.#extractWebhookId(WEBHOOK_ID) !== this.#extractWebhookId(WEBHOOK_TOKEN)) {
            throw new Error("[LibertyJS]: WEBHOOK_ID and WEBHOOK_TOKEN must identify the same webhook");
        }
        if (WEBHOOK_URL && !webhookToken) {
            throw new Error("[LibertyJS]: WEBHOOK_ID is required if you are using a webhook relay");
        }

        this.#SERVER_KEY = SERVER_KEY;
        this.#GLOBAL_API_KEY = GLOBAL_API_KEY || AUTHORIZATION;
        const coordinationSecret = this.#GLOBAL_API_KEY
            ? `global:${this.#GLOBAL_API_KEY}`
            : `server:${this.#SERVER_KEY}`;
        const coordinationKey = createHash("sha256").update(coordinationSecret).digest("hex");
        if (!SHARED_REQUEST_STATES.has(coordinationKey)) {
            SHARED_REQUEST_STATES.set(coordinationKey, createRequestState());
        }
        this.#requestState = SHARED_REQUEST_STATES.get(coordinationKey);
        this.#PRIVATE_SERVER_API = this.#normalizeBaseURL(PRIVATE_SERVER_API);
        this.#WEBHOOK_PUBLIC_KEY = WEBHOOK_PUBLIC_KEY;
        this.#fetch = FETCH;
        this.#maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES;
        this.#useWebhookRelay = Boolean(webhookToken);

        if (this.#useWebhookRelay) {
            this.#WEBHOOK_URL = this.#normalizeBaseURL(WEBHOOK_URL || DEFAULT_WEBHOOK_RELAY_URL);
            this.#WEBHOOK_TOKEN = webhookToken;
        }

        this.commands = new CommandRouter({
            pollEvents: this.#useWebhookRelay ? options => this.webhook.events(options) : undefined,
            sendCommands: commands => this.sendPrivateServerCommand(commands),
            getServer: options => this.getPrivateServerAPI(options),
            verifyWebhook: input => this.verifyWebhook(input)
        });
    }

    #normalizeBaseURL(value) {
        if (typeof value !== "string" || !value.trim()) {
            throw new Error("[LibertyJS]: API URLs must be non-empty strings");
        }
        const url = new URL(value);
        url.pathname = `${this.#stripTrailingSlashes(url.pathname)}/`;
        return url.toString();
    }

    #stripTrailingSlashes(value) {
        let end = value.length;
        while (end > 0 && value.charCodeAt(end - 1) === 47) end--;
        return value.slice(0, end);
    }

    #stripLeadingSlashes(value) {
        let start = 0;
        while (start < value.length && value.charCodeAt(start) === 47) start++;
        return value.slice(start);
    }

    #extractWebhookId(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";

        const cleaned = this.#stripTrailingSlashes(raw.split("?")[0].split("#")[0]);
        const parts = cleaned.split("/").filter(Boolean);
        if (!parts.length) return "";
        if (parts.at(-1).toLowerCase() === "events" && parts.length > 1) return parts.at(-2);
        return parts.at(-1);
    }

    #url(path) {
        return new URL(this.#stripLeadingSlashes(path), this.#PRIVATE_SERVER_API);
    }

    #wait(milliseconds) {
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    }

    #headersToObject(headers) {
        if (!headers || typeof headers.entries !== "function") return {};
        return Object.fromEntries(headers.entries());
    }

    #readRateLimit(res, routeKey) {
        const bucket = res.headers.get("X-RateLimit-Bucket") || this.#requestState.routeBuckets.get(routeKey) || routeKey;
        const numberHeader = name => {
            const value = res.headers.get(name);
            if (value === null || value === "") return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };
        const limit = numberHeader("X-RateLimit-Limit");
        const remaining = numberHeader("X-RateLimit-Remaining");
        const reset = numberHeader("X-RateLimit-Reset");

        this.#requestState.routeBuckets.set(routeKey, bucket);
        this.#requestState.rateLimits.set(bucket, {
            limit,
            remaining,
            reset
        });
    }

    async #waitForKnownLimit(routeKey) {
        const buckets = new Set();
        const routeBucket = this.#requestState.routeBuckets.get(routeKey);
        if (routeBucket) buckets.add(routeBucket);
        for (const bucket of this.#requestState.rateLimits.keys()) {
            if (bucket === "global" || bucket.endsWith("-global")) buckets.add(bucket);
        }

        let resetAt = 0;
        for (const bucket of buckets) {
            const rateLimit = this.#requestState.rateLimits.get(bucket);
            if (rateLimit?.remaining === 0 && rateLimit.reset) {
                resetAt = Math.max(resetAt, rateLimit.reset * 1000);
            }
        }

        const waitMilliseconds = Math.max(0, resetAt - Date.now());
        if (waitMilliseconds > 0) await this.#wait(waitMilliseconds);
    }

    #retryAfterMilliseconds(res, data) {
        const retryAfterValue = res.headers.get("Retry-After");
        const retryAfterHeader = retryAfterValue === null ? null : Number(retryAfterValue);
        if (retryAfterHeader !== null && Number.isFinite(retryAfterHeader) && retryAfterHeader >= 0) {
            return retryAfterHeader * 1000;
        }

        const retryAfterBody = data?.retry_after === undefined ? null : Number(data.retry_after);
        if (retryAfterBody !== null && Number.isFinite(retryAfterBody) && retryAfterBody >= 0) {
            return retryAfterBody * 1000;
        }

        const resetValue = res.headers.get("X-RateLimit-Reset");
        const reset = resetValue === null ? null : Number(resetValue);
        if (reset !== null && Number.isFinite(reset)) return Math.max(0, (reset * 1000) - Date.now());
        return 1000;
    }

    async #fetchAPI(url, options = {}) {
        const request = this.#requestState.requestQueue.then(
            () => this.#performFetchAPI(url, options),
            () => this.#performFetchAPI(url, options)
        );
        this.#requestState.requestQueue = request.then(() => undefined, () => undefined);
        return await request;
    }

    async #performFetchAPI(url, options = {}) {
        if (this.#resStatus.forbiddenErrors >= 3) {
            return {
                error: "forbidden",
                message: "[LibertyJS]: Repeated authentication failures; API calls for this server key are suspended",
                status: 403
            };
        }

        const targetURL = url instanceof URL ? url : new URL(url);
        const method = (options.method || "GET").toUpperCase();
        const isERLC = targetURL.origin === new URL(DEFAULT_API_URL).origin;
        const routeKey = `${method} ${targetURL.pathname}`;
        const headers = new Headers(options.headers || {});
        let body = options.body;

        if (body !== undefined && body !== null && method !== "GET" && method !== "HEAD") {
            if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body) && typeof body !== "string") {
                body = JSON.stringify(body);
            }
            if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        }

        if (isERLC) {
            headers.set("server-key", this.#SERVER_KEY);
            if (this.#GLOBAL_API_KEY) headers.set("Authorization", this.#GLOBAL_API_KEY);
        }

        for (let attempt = 0; attempt <= this.#maxRateLimitRetries; attempt++) {
            if (isERLC) await this.#waitForKnownLimit(routeKey);

            let res;
            try {
                res = await this.#fetch(targetURL, { ...options, method, headers, body });
            } catch (cause) {
                return {
                    error: "network-error",
                    message: `[LibertyJS]: Network error while fetching ${isERLC ? targetURL : "the webhook relay"}`,
                    cause: cause instanceof Error ? cause.message : String(cause)
                };
            }

            let data = null;
            try {
                data = await res.json();
            } catch {
                // Some valid responses may not include a JSON body.
            }

            if (isERLC) this.#readRateLimit(res, routeKey);

            if (res.status === 429 && attempt < this.#maxRateLimitRetries) {
                await this.#wait(this.#retryAfterMilliseconds(res, data));
                continue;
            }

            if (!res.ok) {
                const authenticationFailure = res.status === 403 && [2000, 2001, 2002, 2003, 2004].includes(data?.code);
                if (authenticationFailure) this.#resStatus.forbiddenErrors++;

                return {
                    error: res.status === 429 ? "rate-limited" : "api-error",
                    message: `[LibertyJS]: ${isERLC ? `ER:LC API returned HTTP ${res.status} for ${targetURL}` : `Webhook relay returned HTTP ${res.status}`}`,
                    status: res.status,
                    statusText: res.statusText,
                    code: data?.code,
                    retryAfter: res.status === 429 ? this.#retryAfterMilliseconds(res, data) / 1000 : undefined,
                    headers: this.#headersToObject(res.headers),
                    apiResponse: data
                };
            }

            this.#resStatus.forbiddenErrors = 0;
            return data;
        }
    }

    async getPrivateServerAPI(options = [], includeInvalid = false) {
        if (!Array.isArray(options)) {
            return {
                error: "invalid_input",
                message: "[LibertyJS.getPrivateServerAPI]: Options must be an array"
            };
        }

        const url = this.#url("server");
        const invalidOptions = [];
        for (const option of new Set(options)) {
            if (VALID_SERVER_OPTIONS.has(option)) url.searchParams.set(option, "true");
            else invalidOptions.push(option);
        }

        const data = await this.#fetchAPI(url);
        return includeInvalid ? { data, invalidOptions } : data;
    }

    async sendPrivateServerCommand(commands = []) {
        if (!Array.isArray(commands)) {
            return {
                error: "invalid_input",
                message: "[LibertyJS.sendPrivateServerCommand]: Commands must be an array"
            };
        }
        if (commands.length === 0) {
            return {
                error: "invalid_input",
                message: "[LibertyJS.sendPrivateServerCommand]: Commands must have at least one item"
            };
        }

        const url = this.#url("server/command");
        let successes = 0;
        let failures = 0;
        const failureReasons = [];
        const results = [];

        for (const command of commands) {
            if (typeof command !== "string" || !command.trim()) {
                failures++;
                failureReasons.push({ command, error: "Command must be a non-empty string" });
                continue;
            }

            const normalizedCommand = command.trim();
            const response = await this.#fetchAPI(url, {
                method: "POST",
                body: { command: normalizedCommand }
            });

            results.push({ command: normalizedCommand, response });
            if (response?.error) {
                failures++;
                failureReasons.push({
                    command: normalizedCommand,
                    status: response.status,
                    code: response.code,
                    apiResponse: response.apiResponse
                });
            } else {
                successes++;
            }
        }

        return { successes, failures, failureReasons, results };
    }

    verifyWebhook({ timestamp, signature, rawBody, publicKey = this.#WEBHOOK_PUBLIC_KEY } = {}) {
        if (typeof timestamp !== "string" || !timestamp) return false;
        if (typeof signature !== "string" || !/^[0-9a-f]+$/i.test(signature) || signature.length % 2 !== 0) {
            return false;
        }
        if (!(typeof rawBody === "string" || rawBody instanceof Uint8Array || rawBody instanceof ArrayBuffer)) {
            return false;
        }

        try {
            const body = typeof rawBody === "string"
                ? Buffer.from(rawBody)
                : Buffer.from(rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : rawBody);
            const message = Buffer.concat([Buffer.from(timestamp, "utf8"), body]);
            const key = createPublicKey({
                key: Buffer.from(publicKey, "base64"),
                format: "der",
                type: "spki"
            });
            return verifySignature(null, message, key, Buffer.from(signature, "hex"));
        } catch {
            return false;
        }
    }

    webhook = {
        verify: input => this.verifyWebhook(input),
        erlcUrl: () => {
            if (!this.#useWebhookRelay) return null;
            return new URL(`webhook/${encodeURIComponent(this.#WEBHOOK_TOKEN)}`, this.#WEBHOOK_URL).toString();
        },
        status: async ({ signal } = {}) => {
            if (!this.#useWebhookRelay) {
                return {
                    error: "webhook_disabled",
                    message: "[LibertyJS.webhook.status]: Webhook relay is not configured"
                };
            }
            return await this.#fetchAPI(new URL("health", this.#WEBHOOK_URL), { signal });
        },
        listEvents: async ({ signal } = {}) => {
            if (!this.#useWebhookRelay) {
                return {
                    error: "webhook_disabled",
                    message: "[LibertyJS.webhook.events]: Webhook relay is not configured"
                };
            }
            return await this.#fetchAPI(
                new URL(`webhook/${encodeURIComponent(this.#WEBHOOK_TOKEN)}/events`, this.#WEBHOOK_URL),
                { signal }
            );
        },
        events: options => this.webhook.listEvents(options)
    };
}

export { CommandRouter, DEFAULT_WEBHOOK_RELAY_URL, ERLC_WEBHOOK_PUBLIC_KEY };
