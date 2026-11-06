import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

const DEFAULT_POLL_INTERVAL = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT = 10_000;
const DEFAULT_MAX_SEEN_EVENTS = 1_000;
const MAX_MESSAGE_LENGTH = 200;
const PLAYER_CACHE_TTL = 10_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY = 1_000;
const RETRY_MAX_DELAY = 60_000;

function retryDelay(attempts) {
    return Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * (2 ** (attempts - 1)));
}

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
    if (!isRecord(input)) return null;
    const data = input.data && typeof input.data === "object" ? input.data : {};
    const type = String(input.event ?? input.type ?? data.event ?? data.type ?? "");
    if (type.toLowerCase() !== "customcommand") return null;

    const command = normalizeCommandName(input.command ?? data.command);
    if (!command) return null;
    const argument = String(input.argument ?? data.argument ?? "");
    const userId = String(input.userId ?? data.userId ?? data.userID ?? input.origin ?? "");
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

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIdentity(value) {
    return (typeof value === "string" && value.trim().length > 0) ||
        (Number.isSafeInteger(value) && value >= 0);
}

function isWebhookEvent(value) {
    if (!isRecord(value) || (value.data !== undefined && !isRecord(value.data))) return false;
    const data = value.data ?? {};
    const type = value.event ?? value.type ?? data.event ?? data.type;
    if (typeof type !== "string" || !type.trim()) return false;
    for (const id of [value.id, value._id, value.origin, value.userId, data.userId, data.userID,
        value.serverId, value.server, data.serverId, data.server]) {
        if (id !== undefined && !isIdentity(id)) return false;
    }
    if (type.toLowerCase() !== "customcommand") return true;
    const argument = value.argument ?? data.argument;
    return Boolean(normalizeCommandName(value.command ?? data.command)) &&
        (argument === undefined || typeof argument === "string");
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
    #seenEvents = new Map();
    #pendingRetries = new Map();
    #inFlight = new Map();
    #pollEvents;
    #acknowledgeEvents;
    #sendCommands;
    #getServer;
    #verifyWebhook;
    #running = false;
    #controller;
    #loopPromise;
    #externalAbortCleanup;
    #maxSeenEvents;
    #playerCache = new Map();
    #cooldownChecks = 0;

    constructor({ pollEvents, acknowledgeEvents, sendCommands, getServer, verifyWebhook, maxSeenEvents = DEFAULT_MAX_SEEN_EVENTS } = {}) {
        super();
        this.#pollEvents = pollEvents;
        this.#acknowledgeEvents = acknowledgeEvents;
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

    command(name, handler, { cooldown = 0, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
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
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            throw new Error("[LibertyJS.commands]: maxAttempts must be a positive integer");
        }
        this.#handlers.set(normalized, { handler, cooldown, maxAttempts });
        return this;
    }

    remove(name) {
        const normalized = normalizeCommandName(name);
        return normalized ? this.#handlers.delete(normalized) : false;
    }

    async handle(input) {
        const event = normalizeEvent(input);
        if (!event) return { status: "ignored", reason: "unsupported_event" };
        const active = this.#inFlight.get(event.id);
        if (active) {
            const result = await active;
            return result.status === "failed" ? result
                : { status: "duplicate", eventId: event.id, command: event.command };
        }
        // Register before invoking user code, including synchronous handlers.
        const attempt = Promise.resolve().then(() => this.#handleEvent(event));
        this.#inFlight.set(event.id, attempt);
        try {
            return await attempt;
        } finally {
            this.#inFlight.delete(event.id);
        }
    }

    async #handleEvent(event) {
        const previous = this.#pendingRetries.get(event.id) ?? this.#seenEvents.get(event.id);
        if (previous && previous.status !== "failed") {
            return { status: "duplicate", eventId: event.id, command: event.command };
        }
        // A failed event is not rerun after its final attempt or before its
        // backoff delay ends. Poll fetches it again without repeating side effects.
        if (previous?.status === "failed" && (!previous.willRetry || previous.retryAt > Date.now())) {
            return previous;
        }

        const registration = this.#handlers.get(event.command);
        if (!registration) {
            const result = { status: "unhandled", eventId: event.id, command: event.command };
            this.#rememberEvent(event.id, result);
            this.emit("unhandled", result);
            return result;
        }

        const cooldownKey = `${event.command}:${event.userId || "unknown"}`;
        const now = Date.now();
        if (++this.#cooldownChecks % 100 === 0) {
            for (const [key, reservation] of this.#cooldowns) {
                if (reservation.expiresAt <= now) this.#cooldowns.delete(key);
            }
        }
        const availableAt = this.#cooldowns.get(cooldownKey)?.expiresAt ?? 0;
        if (availableAt <= now) this.#cooldowns.delete(cooldownKey);
        if (availableAt > now) {
            // A later successful command may own this cooldown. Keep an earlier
            // failed event pending until it can retry rather than acknowledging it.
            if (previous?.status === "failed") return previous;
            const result = {
                status: "cooldown",
                eventId: event.id,
                command: event.command,
                remaining: availableAt - now
            };
            this.#rememberEvent(event.id, result);
            this.emit("cooldown", result);
            return result;
        }
        const reservation = { expiresAt: now + registration.cooldown };
        if (registration.cooldown > 0) this.#cooldowns.set(cooldownKey, reservation);

        const context = this.#createContext(event);
        try {
            const value = await registration.handler(context);
            const result = { status: "handled", eventId: event.id, command: event.command, value };
            this.#rememberEvent(event.id, { status: "handled" });
            this.emit("handled", result);
            return result;
        } catch (error) {
            // Release only this attempt's reservation; a newer attempt may have
            // acquired the cooldown while a slow handler was still running.
            if (this.#cooldowns.get(cooldownKey) === reservation) this.#cooldowns.delete(cooldownKey);
            const attempts = (previous?.status === "failed" ? previous.attempts ?? 1 : 0) + 1;
            // When the retry list is full, a new failure is final rather than evicting
            // another event's attempt count (which would let it bypass maxAttempts).
            const retrySlot = this.#pendingRetries.has(event.id) || this.#pendingRetries.size < this.#maxSeenEvents;
            const willRetry = attempts < registration.maxAttempts && retrySlot;
            const result = {
                status: "failed",
                eventId: event.id,
                command: event.command,
                error,
                attempts,
                willRetry,
                retryAt: willRetry ? Date.now() + retryDelay(attempts) : undefined
            };
            this.#rememberEvent(event.id, result);
            this.emit("commandError", result);
            return result;
        }
    }

    async handleWebhook(input) {
        let verified = false;
        try {
            verified = typeof this.#verifyWebhook === "function" && this.#verifyWebhook(input) === true;
        } catch {
            // A verifier error must never authorize a request.
        }
        if (!verified) {
            return { status: "rejected", reason: "invalid_signature" };
        }
        let payload;
        let bytes;
        try {
            const rawBody = input?.rawBody;
            bytes = typeof rawBody === "string"
                ? rawBody
                : Buffer.from(rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : rawBody).toString("utf8");
            payload = JSON.parse(bytes);
        } catch {
            return { status: "rejected", reason: "invalid_json" };
        }
        if (!isRecord(payload)) return { status: "rejected", reason: "invalid_payload" };
        if (!Object.hasOwn(payload, "events")) return await this.handle(payload);

        const serverId = isRecord(payload.server) ? payload.server.id : payload.server;
        // Validate the entire envelope before invoking any handler. A malformed
        // later entry must not cause a partially processed, rejected request.
        if (!Array.isArray(payload.events) || !payload.events.every(isWebhookEvent) ||
            (isRecord(payload.server) && !isIdentity(payload.server.id)) ||
            (serverId !== undefined && !isIdentity(serverId))) {
            return { status: "rejected", reason: "invalid_payload" };
        }
        const batchId = createHash("sha256").update(bytes).digest("hex");
        const results = [];
        for (const [index, event] of payload.events.entries()) {
            results.push(await this.handle({
                ...event,
                // Include the position so two identical events in one batch
                // stay distinct while an exact replay keeps the same IDs.
                id: event.id ?? event._id ?? `${batchId}:${index}`,
                serverId: event.serverId ?? event.server ?? event.data?.serverId ?? event.data?.server ?? serverId
            }));
        }
        return { status: "batch", results };
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

    // Finished events and pending retries are kept in separate bounded maps so
    // neither can push the other out: a burst of failures cannot erase the record
    // that a command already ran, and finished work cannot reset a retry count.
    #rememberEvent(id, result) {
        if (result.status === "failed" && result.willRetry) {
            this.#seenEvents.delete(id);
            this.#pendingRetries.set(id, result); // capacity is checked before willRetry is set
            return;
        }
        this.#pendingRetries.delete(id);
        this.#seenEvents.delete(id);
        this.#seenEvents.set(id, result);
        if (this.#seenEvents.size > this.#maxSeenEvents) {
            this.#seenEvents.delete(this.#seenEvents.keys().next().value);
        }
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
            // Async so an invalid message rejects like reply() instead of throwing synchronously.
            announce: async message => await this.#runCommand(`:h ${sanitizeMessage(message)}`)
        };
    }

    async #reply(event, value) {
        const message = sanitizeMessage(value);
        // The signed event's display name can be stale; the user ID identifies the player.
        const username = await this.#resolveUsername(event.userId);
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
                // Drop expired entries so a long-running bot does not keep every past player.
                const now = Date.now();
                for (const [id, entry] of this.#playerCache) {
                    if (entry.expiresAt <= now) this.#playerCache.delete(id);
                }
                this.#playerCache.set(userId, { username, expiresAt: now + PLAYER_CACHE_TTL });
                return username;
            }
        }
        return "";
    }

    async #runCommand(command) {
        if (typeof this.#sendCommands !== "function") {
            return { error: "command_unavailable", message: "[LibertyJS.commands]: Command transport is not configured" };
        }
        const result = await this.#sendCommands([command]);
        // Surface a rejected command as an error so `if (result.error)` checks work.
        if (result && !result.error && result.failures > 0) {
            return {
                ...result,
                error: "command_failed",
                // Not "rejected": network errors and unreadable responses also count as
                // failures, and the command may already have run. Do not blindly resend.
                message: "[LibertyJS.commands]: Could not confirm that ER:LC accepted the command; see failureReasons and results"
            };
        }
        return result;
    }

    async #pollLoop(pollInterval, signal) {
        let cursor;
        try {
            while (!signal.aborted) {
                let wait = pollInterval;
                try {
                    const response = await this.#pollEvents({ signal, cursor });
                    if (signal.aborted) break;
                    if (response?.error) {
                        const error = new Error(`[LibertyJS.commands]: Poll request failed (${response.error})`);
                        this.emit("pollError", { error });
                        if (response.error === "rate-limited" && Number.isFinite(response.retryAfter)) {
                            wait = Math.max(wait, response.retryAfter * 1_000);
                        }
                    } else {
                        const events = Array.isArray(response) ? response : response?.events;
                        if (!Array.isArray(events)) {
                            this.emit("pollError", {
                                error: new Error("[LibertyJS.commands]: Poll response did not include an events array")
                            });
                        } else {
                            const acknowledged = [];
                            for (const event of events) {
                                if (signal.aborted) break;
                                const result = await this.handle(event);
                                // Retryable failures stay pending; a final failure is acknowledged.
                                const finished = result.status !== "failed" || result.willRetry === false;
                                if (finished && event && typeof event === "object" && typeof event.id === "string") {
                                    acknowledged.push(event.id);
                                }
                            }
                            if (acknowledged.length && typeof this.#acknowledgeEvents === "function") {
                                // Not tied to the stop signal: work that already ran must still be
                                // acknowledged during shutdown, or a restart would run it again.
                                const result = await this.#acknowledgeEvents(acknowledged);
                                if (result?.error) this.emit("pollError", {
                                    error: new Error(`[LibertyJS.commands]: Poll acknowledgement failed (${result.error})`)
                                });
                            }
                            cursor = response?.hasMore && typeof response.nextCursor === "string"
                                ? response.nextCursor : undefined;
                        }
                    }
                } catch (error) {
                    if (!signal.aborted) this.emit("pollError", { error });
                }
                if (!signal.aborted) await abortableWait(wait, signal);
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
