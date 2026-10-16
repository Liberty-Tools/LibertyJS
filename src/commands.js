import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const DEFAULT_POLL_INTERVAL = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;
const DEFAULT_MAX_SEEN_EVENTS = 1_000;
const MAX_MESSAGE_LENGTH = 200;
const PLAYER_CACHE_TTL = 10_000;

function normalizeCommandName(value) {
    if (typeof value !== "string") return "";
    const name = value.trim().replace(/^;/, "").toLowerCase();
    if (!name || /\s/.test(name)) return "";
    return name;
}

function parseArguments(value) {
    const input = typeof value === "string" ? value : "";
    const args = [];
    let current = "";
    let quote = "";
    let escaped = false;

    for (const character of input) {
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = "";
            else current += character;
            continue;
        }
        if (character === "\"" || character === "'") {
            quote = character;
            continue;
        }
        if (/\s/.test(character)) {
            if (current) {
                args.push(current);
                current = "";
            }
            continue;
        }
        current += character;
    }

    if (escaped) current += "\\";
    if (current) args.push(current);
    return args;
}

function normalizeEvent(input) {
    if (!input || typeof input !== "object") return null;
    const data = input.data && typeof input.data === "object" ? input.data : {};
    const type = String(input.event ?? input.type ?? data.event ?? data.type ?? "");
    if (type.toLowerCase() !== "customcommand") return null;

    const command = normalizeCommandName(input.command ?? data.command);
    if (!command) return null;
    const argument = String(input.argument ?? data.argument ?? "");
    const userId = String(input.userId ?? data.userId ?? data.userID ?? "");
    const serverId = String(input.serverId ?? input.server ?? data.serverId ?? data.server ?? "");
    const id = String(input.id ?? input._id ?? createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"));

    return {
        id,
        type: "CustomCommand",
        command,
        argument,
        args: parseArguments(argument),
        userId,
        serverId,
        username: extractUsername(input, data),
        timestamp: input.timestamp ?? data.timestamp,
        receivedAt: input.createdAt ?? input.receivedAt ?? data.receivedAt,
        raw: input
    };
}

function extractUsername(input, data) {
    for (const value of [input.username, input.playerName, data.username, data.playerName]) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    for (const value of [input.player, input.Player, data.player, data.Player]) {
        if (typeof value !== "string" || !value.trim()) continue;
        return value.includes(":") ? value.slice(0, value.lastIndexOf(":")) : value;
    }
    return "";
}

function sanitizeMessage(value) {
    if (typeof value !== "string") {
        throw new TypeError("[LibertyJS.commands]: Message must be a string");
    }
    const message = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    if (!message) throw new Error("[LibertyJS.commands]: Message must not be empty");
    if (message.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`[LibertyJS.commands]: Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }
    return message;
}

function playerIdentity(entry) {
    if (!entry || typeof entry !== "object") return null;
    const combined = entry.Player ?? entry.player;
    if (typeof combined === "string" && combined.includes(":")) {
        const separator = combined.lastIndexOf(":");
        return { username: combined.slice(0, separator), userId: combined.slice(separator + 1) };
    }
    const username = entry.Username ?? entry.username ?? entry.Name ?? entry.name;
    const userId = entry.Id ?? entry.ID ?? entry.id ?? entry.UserId ?? entry.userId;
    if (typeof username !== "string" || userId === undefined || userId === null) return null;
    return { username, userId: String(userId) };
}

function safeUsername(value) {
    return typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value) ? value : "";
}

function abortableWait(milliseconds, signal) {
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

export class CommandRouter extends EventEmitter {
    #handlers = new Map();
    #cooldowns = new Map();
    #seenEvents = new Set();
    #seenOrder = [];
    #pollEvents;
    #sendCommands;
    #getServer;
    #verifyWebhook;
    #running = false;
    #controller;
    #loopPromise;
    #externalAbortCleanup;
    #maxSeenEvents;
    #playerCache = new Map();

    constructor({ pollEvents, sendCommands, getServer, verifyWebhook, maxSeenEvents = DEFAULT_MAX_SEEN_EVENTS } = {}) {
        super();
        this.#pollEvents = pollEvents;
        this.#sendCommands = sendCommands;
        this.#getServer = getServer;
        this.#verifyWebhook = verifyWebhook;
        if (!Number.isInteger(maxSeenEvents) || maxSeenEvents < 1) {
            throw new Error("[LibertyJS.commands]: maxSeenEvents must be a positive integer");
        }
        this.#maxSeenEvents = maxSeenEvents;
    }

    get running() {
        return this.#running;
    }

    command(name, handler, { cooldown = 0 } = {}) {
        const normalized = normalizeCommandName(name);
        if (!normalized) {
            throw new Error("[LibertyJS.commands]: Command name must be a non-empty name without whitespace");
        }
        if (typeof handler !== "function") {
            throw new TypeError("[LibertyJS.commands]: Command handler must be a function");
        }
        if (!Number.isFinite(cooldown) || cooldown < 0) {
            throw new Error("[LibertyJS.commands]: cooldown must be a non-negative number of milliseconds");
        }
        this.#handlers.set(normalized, { handler, cooldown });
        return this;
    }

    remove(name) {
        const normalized = normalizeCommandName(name);
        return normalized ? this.#handlers.delete(normalized) : false;
    }

    async handle(input) {
        const event = normalizeEvent(input);
        if (!event) return { status: "ignored", reason: "unsupported_event" };
        if (this.#seenEvents.has(event.id)) {
            return { status: "duplicate", eventId: event.id, command: event.command };
        }

        this.#rememberEvent(event.id);
        const registration = this.#handlers.get(event.command);
        if (!registration) {
            const result = { status: "unhandled", eventId: event.id, command: event.command };
            this.emit("unhandled", result);
            return result;
        }

        const cooldownKey = `${event.command}:${event.userId || "unknown"}`;
        const now = Date.now();
        const availableAt = this.#cooldowns.get(cooldownKey) ?? 0;
        if (availableAt > now) {
            const result = {
                status: "cooldown",
                eventId: event.id,
                command: event.command,
                remaining: availableAt - now
            };
            this.emit("cooldown", result);
            return result;
        }
        if (registration.cooldown > 0) {
            this.#cooldowns.set(cooldownKey, now + registration.cooldown);
        }

        const context = this.#createContext(event);
        try {
            const value = await registration.handler(context);
            const result = { status: "handled", eventId: event.id, command: event.command, value };
            this.emit("handled", result);
            return result;
        } catch (error) {
            const result = { status: "failed", eventId: event.id, command: event.command, error };
            this.emit("commandError", result);
            return result;
        }
    }

    async handleWebhook(input) {
        if (typeof this.#verifyWebhook !== "function" || !this.#verifyWebhook(input)) {
            return { status: "rejected", reason: "invalid_signature" };
        }
        try {
            const rawBody = input?.rawBody;
            const bytes = typeof rawBody === "string"
                ? rawBody
                : Buffer.from(rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : rawBody).toString("utf8");
            return await this.handle(JSON.parse(bytes));
        } catch {
            return { status: "rejected", reason: "invalid_json" };
        }
    }

    async start({ pollInterval = DEFAULT_POLL_INTERVAL, signal } = {}) {
        if (this.#running) return this;
        if (typeof this.#pollEvents !== "function") {
            throw new Error("[LibertyJS.commands]: Poll transport is not configured");
        }
        if (!Number.isFinite(pollInterval) || pollInterval < 100) {
            throw new Error("[LibertyJS.commands]: pollInterval must be at least 100 milliseconds");
        }

        this.#running = true;
        this.#controller = new AbortController();
        if (signal) {
            const abort = () => this.#controller?.abort();
            if (signal.aborted) abort();
            else {
                signal.addEventListener("abort", abort, { once: true });
                this.#externalAbortCleanup = () => signal.removeEventListener("abort", abort);
            }
        }
        this.#loopPromise = this.#pollLoop(pollInterval, this.#controller.signal);
        return this;
    }

    async stop({ timeout = DEFAULT_SHUTDOWN_TIMEOUT } = {}) {
        if (!Number.isFinite(timeout) || timeout < 0) {
            throw new Error("[LibertyJS.commands]: timeout must be a non-negative number of milliseconds");
        }
        if (!this.#running && !this.#loopPromise) return;
        this.#running = false;
        this.#controller?.abort();
        this.#externalAbortCleanup?.();
        this.#externalAbortCleanup = undefined;

        const loop = this.#loopPromise;
        if (loop) {
            if (timeout === 0) await loop;
            else await this.#waitForStop(loop, timeout);
        }
    }

    async #waitForStop(loop, timeout) {
        let timer;
        try {
            await Promise.race([
                loop,
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error("[LibertyJS.commands]: Timed out while stopping command router")),
                        timeout
                    );
                })
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    #rememberEvent(id) {
        this.#seenEvents.add(id);
        this.#seenOrder.push(id);
        if (this.#seenOrder.length <= this.#maxSeenEvents) return;
        const removed = this.#seenOrder.shift();
        if (removed) this.#seenEvents.delete(removed);
    }

    #createContext(event) {
        return {
            event,
            command: event.command,
            argument: event.argument,
            args: [...event.args],
            userId: event.userId,
            serverId: event.serverId,
            reply: message => this.#reply(event, message),
            announce: message => this.#runCommand(`:h ${sanitizeMessage(message)}`)
        };
    }

    async #reply(event, value) {
        const message = sanitizeMessage(value);
        const username = safeUsername(event.username) || await this.#resolveUsername(event.userId);
        if (!username) {
            return {
                error: "player_not_found",
                message: "[LibertyJS.commands]: The triggering player is no longer available"
            };
        }
        return await this.#runCommand(`:pm ${username} ${message}`);
    }

    async #resolveUsername(userId) {
        if (!userId || typeof this.#getServer !== "function") return "";
        const cached = this.#playerCache.get(userId);
        if (cached?.expiresAt > Date.now()) return cached.username;
        if (cached) this.#playerCache.delete(userId);

        const response = await this.#getServer(["Players"]);
        if (!response || typeof response !== "object" || response.error || !Array.isArray(response.Players)) return "";
        for (const entry of response.Players) {
            const identity = playerIdentity(entry);
            const username = safeUsername(identity?.username);
            if (identity?.userId === userId && username) {
                this.#playerCache.set(userId, { username, expiresAt: Date.now() + PLAYER_CACHE_TTL });
                return username;
            }
        }
        return "";
    }

    async #runCommand(command) {
        if (typeof this.#sendCommands !== "function") {
            return { error: "command_unavailable", message: "[LibertyJS.commands]: Command transport is not configured" };
        }
        return await this.#sendCommands([command]);
    }

    async #pollLoop(pollInterval, signal) {
        try {
            while (!signal.aborted) {
                try {
                    const response = await this.#pollEvents({ signal });
                    if (response?.error) {
                        const error = new Error(`[LibertyJS.commands]: Poll request failed (${response.error})`);
                        this.emit("pollError", { error });
                    } else {
                        const events = Array.isArray(response) ? response : response?.events;
                        if (!Array.isArray(events)) {
                            this.emit("pollError", {
                                error: new Error("[LibertyJS.commands]: Poll response did not include an events array")
                            });
                        } else {
                            for (const event of events) {
                                if (signal.aborted) break;
                                await this.handle(event);
                            }
                        }
                    }
                } catch (error) {
                    this.emit("pollError", { error });
                }
                if (!signal.aborted) await abortableWait(pollInterval, signal);
            }
        } finally {
            this.#running = false;
            this.#controller = undefined;
            this.#loopPromise = undefined;
            this.#externalAbortCleanup?.();
            this.#externalAbortCleanup = undefined;
        }
    }
}

export { normalizeCommandName, parseArguments };
