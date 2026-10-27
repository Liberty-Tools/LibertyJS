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
    #WEBHOOK_INGEST_URL;
    #POLL_SUBSCRIPTION_ID;
    #POLL_TOKEN;
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
        WEBHOOK_INGEST_URL,
        POLL_SUBSCRIPTION_ID,
        POLL_TOKEN,
        LIBERTY_API_URL = DEFAULT_WEBHOOK_RELAY_URL,
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
        const usesV2Poll = Boolean(POLL_SUBSCRIPTION_ID || POLL_TOKEN);
        if (usesV2Poll && (!POLL_SUBSCRIPTION_ID || !POLL_TOKEN || typeof POLL_SUBSCRIPTION_ID !== "string" || typeof POLL_TOKEN !== "string")) {
            throw new Error("[LibertyJS]: POLL_SUBSCRIPTION_ID and POLL_TOKEN are both required for v2 Poll mode");
        }
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
        this.#useWebhookRelay = Boolean(webhookToken || usesV2Poll);

        if (usesV2Poll) {
            this.#WEBHOOK_URL = this.#normalizeBaseURL(LIBERTY_API_URL);
            this.#POLL_SUBSCRIPTION_ID = POLL_SUBSCRIPTION_ID;
            this.#POLL_TOKEN = POLL_TOKEN;
            if (WEBHOOK_INGEST_URL) this.#WEBHOOK_INGEST_URL = new URL(WEBHOOK_INGEST_URL).toString();
        } else if (this.#useWebhookRelay) {
            this.#WEBHOOK_URL = this.#normalizeBaseURL(WEBHOOK_URL || DEFAULT_WEBHOOK_RELAY_URL);
            this.#WEBHOOK_TOKEN = webhookToken;
        }

        this.commands = new CommandRouter({
            pollEvents: this.#useWebhookRelay ? options => this.webhook.events(options) : undefined,
            acknowledgeEvents: this.#POLL_SUBSCRIPTION_ID ? (eventIds, options) => this.webhook.acknowledge(eventIds, options) : undefined,
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

    #wait(milliseconds, signal) {
        if (signal?.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(done, milliseconds);
            function done() {
                clearTimeout(timer);
                signal?.removeEventListener("abort", done);
                resolve();
            }
            signal?.addEventListener("abort", done, { once: true });
        });
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
        // Only ER:LC requests share a rate-limit queue. A slow Poll retry must
        // never block an unrelated command sent to the official API.
        const targetURL = url instanceof URL ? url : new URL(url);
        if (targetURL.origin !== new URL(DEFAULT_API_URL).origin) {
            return await this.#performFetchAPI(targetURL, options);
        }
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
            if (options.signal?.aborted) return {
                error: "network-error", message: "[LibertyJS]: Request aborted"
            };
            if (isERLC) await this.#waitForKnownLimit(routeKey);

            let res;
            try {
                res = await this.#fetch(targetURL, { ...options, method, headers, body });
            } catch {
                return {
                    error: "network-error",
                    message: `[LibertyJS]: Network error while fetching ${isERLC ? targetURL : "the webhook relay"}`
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
                await this.#wait(this.#retryAfterMilliseconds(res, data), options.signal);
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
        const timestampNumber = Number(timestamp);
        if (!Number.isFinite(timestampNumber)) return false;
        const timestampMs = timestampNumber > 10_000_000_000 ? timestampNumber : timestampNumber * 1_000;
        if (Math.abs(Date.now() - timestampMs) > 5 * 60_000) return false;
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
            if (this.#WEBHOOK_INGEST_URL) return this.#WEBHOOK_INGEST_URL;
            if (this.#POLL_SUBSCRIPTION_ID) return null;
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
        listEvents: async ({ signal, cursor, limit } = {}) => {
            if (!this.#useWebhookRelay) {
                return {
                    error: "webhook_disabled",
                    message: "[LibertyJS.webhook.events]: Webhook relay is not configured"
                };
            }
            if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
                throw new RangeError("[LibertyJS.webhook.listEvents]: limit must be an integer from 1 to 100");
            }
            const path = this.#POLL_SUBSCRIPTION_ID
                ? `v1/poll/subscriptions/${encodeURIComponent(this.#POLL_SUBSCRIPTION_ID)}/events`
                : `webhook/${encodeURIComponent(this.#WEBHOOK_TOKEN)}/events`;
            const url = new URL(path, this.#WEBHOOK_URL);
            if (this.#POLL_SUBSCRIPTION_ID) {
                if (cursor) url.searchParams.set("cursor", cursor);
                if (limit !== undefined) url.searchParams.set("limit", String(limit));
            }
            return await this.#fetchAPI(url, {
                signal, ...(this.#POLL_TOKEN ? { headers: { Authorization: `Bearer ${this.#POLL_TOKEN}` } } : {})
            });
        },
        events: options => this.webhook.listEvents(options),
        acknowledge: async (eventIds, { signal } = {}) => {
            if (!this.#POLL_SUBSCRIPTION_ID || !this.#POLL_TOKEN) return {
                error: "webhook_disabled", message: "[LibertyJS.webhook.acknowledge]: v2 Poll mode is not configured"
            };
            return await this.#fetchAPI(new URL(`v1/poll/subscriptions/${encodeURIComponent(this.#POLL_SUBSCRIPTION_ID)}/events/acknowledge`, this.#WEBHOOK_URL), {
                method: "POST", signal, headers: { Authorization: `Bearer ${this.#POLL_TOKEN}` }, body: { eventIds }
            });
        }
    };
}

export { CommandRouter, DEFAULT_WEBHOOK_RELAY_URL, ERLC_WEBHOOK_PUBLIC_KEY };
