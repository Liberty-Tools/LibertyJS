import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import LibertyJS, { CommandRouter } from "../src/index.js";

function jsonResponse(data, init = {}) {
    return new Response(JSON.stringify(data), {
        status: init.status || 200,
        statusText: init.statusText,
        headers: { "Content-Type": "application/json", ...init.headers }
    });
}

function customCommand(overrides = {}) {
    return {
        _id: "event-1",
        event: "CustomCommand",
        command: "help",
        argument: 'Player "final warning"',
        userId: "123",
        server: "server-1",
        ...overrides
    };
}

test("registers semicolon commands and provides a normalized handler context", async () => {
    const router = new CommandRouter();
    let received;
    router.command(";HeLp", context => { received = context; });

    const result = await router.handle(customCommand());

    assert.equal(result.status, "handled");
    assert.equal(received.command, "help");
    assert.equal(received.argument, 'Player "final warning"');
    assert.deepEqual(received.args, ["Player", "final warning"]);
    assert.equal(received.userId, "123");
    assert.equal(received.serverId, "server-1");
});

test("ignores unrelated events and reports unregistered commands", async () => {
    const router = new CommandRouter();
    assert.deepEqual(await router.handle({ event: "EmergencyCall" }), {
        status: "ignored",
        reason: "unsupported_event"
    });
    assert.equal((await router.handle(customCommand({ command: "missing" }))).status, "unhandled");
});

test("handles each event ID once", async () => {
    const router = new CommandRouter();
    let calls = 0;
    router.command("help", () => { calls++; });

    assert.equal((await router.handle(customCommand())).status, "handled");
    assert.equal((await router.handle(customCommand())).status, "duplicate");
    assert.equal(calls, 1);
});

test("applies cooldowns atomically per player", async () => {
    const router = new CommandRouter();
    let release;
    router.command("help", () => new Promise(resolve => { release = resolve; }), { cooldown: 1_000 });

    const first = router.handle(customCommand({ _id: "cooldown-1" }));
    const second = await router.handle(customCommand({ _id: "cooldown-2" }));
    assert.equal(second.status, "cooldown");
    assert.ok(second.remaining > 0);
    release();
    assert.equal((await first).status, "handled");
});

test("remove unregisters a command", async () => {
    const router = new CommandRouter();
    router.command("help", () => {});
    assert.equal(router.remove(";HELP"), true);
    assert.equal((await router.handle(customCommand())).status, "unhandled");
});

test("Poll mode resolves the triggering player and sends one private message", async () => {
    const calls = [];
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        WEBHOOK_ID: "poll-token",
        FETCH: async (url, options) => {
            calls.push({ url: url.toString(), options });
            if (url.toString().endsWith("/webhook/poll-token/events")) {
                return jsonResponse({ count: 1, events: [customCommand()] });
            }
            if (options.method === "GET") {
                return jsonResponse({ Players: [{ Player: "Builder:123" }] });
            }
            return jsonResponse({ message: "Success" });
        }
    });

    sdk.commands.command("help", context => context.reply("Line one\nline two"));
    const handled = new Promise(resolve => sdk.commands.once("handled", resolve));
    await sdk.commands.start({ pollInterval: 100 });
    const result = await handled;
    await sdk.commands.stop();

    assert.equal(result.status, "handled");
    const commandCalls = calls.filter(call => call.options.method === "POST");
    assert.equal(commandCalls.length, 1);
    assert.equal(commandCalls[0].options.body, JSON.stringify({ command: ":pm Builder Line one line two" }));
});

test("reply fails safely when the triggering player is unavailable", async () => {
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async () => jsonResponse({ Players: [] })
    });
    sdk.commands.command("help", context => context.reply("Hello"));

    const result = await sdk.commands.handle(customCommand());
    assert.equal(result.status, "handled");
    assert.equal(result.value.error, "player_not_found");
});

test("reply caches a safe player resolution briefly", async () => {
    let playerRequests = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "cache-server-secret",
        FETCH: async (_url, options) => {
            if (options.method === "GET") {
                playerRequests++;
                return jsonResponse({ Players: [{ Player: "Builder_One:123" }] });
            }
            return jsonResponse({ message: "Success" });
        }
    });
    sdk.commands.command("help", context => context.reply("Hello"));

    await sdk.commands.handle(customCommand({ _id: "cache-1" }));
    await sdk.commands.handle(customCommand({ _id: "cache-2" }));
    assert.equal(playerRequests, 1);
});

test("reply refuses unsafe player names", async () => {
    let commandSent = false;
    const sdk = new LibertyJS({
        SERVER_KEY: "unsafe-name-secret",
        FETCH: async (_url, options) => {
            if (options.method === "GET") return jsonResponse({ Players: [] });
            commandSent = true;
            return jsonResponse({ message: "Success" });
        }
    });
    sdk.commands.command("help", context => context.reply("Hello"));

    const result = await sdk.commands.handle(customCommand({ username: "Bad Name\n:h everyone" }));
    assert.equal(result.value.error, "player_not_found");
    assert.equal(commandSent, false);
});

test("announce sends a sanitized server hint command", async () => {
    let body;
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async (_url, options) => {
            body = options.body;
            return jsonResponse({ message: "Success" });
        }
    });
    sdk.commands.command("news", context => context.announce("Hello\r\n everyone"));

    const result = await sdk.commands.handle(customCommand({ command: "news" }));
    assert.equal(result.status, "handled");
    assert.equal(body, JSON.stringify({ command: ":h Hello everyone" }));
});

test("handles a directly signed official webhook", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const rawBody = Buffer.from(JSON.stringify(customCommand()));
    const timestamp = "1792162000";
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("hex");
    const sdk = new LibertyJS({ SERVER_KEY: "server-secret", WEBHOOK_PUBLIC_KEY: publicKeyBase64 });
    let handled = false;
    sdk.commands.command("help", () => { handled = true; });

    const result = await sdk.commands.handleWebhook({ timestamp, signature, rawBody });
    assert.equal(result.status, "handled");
    assert.equal(handled, true);
    assert.deepEqual(
        await sdk.commands.handleWebhook({ timestamp, signature: "00", rawBody }),
        { status: "rejected", reason: "invalid_signature" }
    );
});

test("handler failures are reported without throwing from the router", async () => {
    const router = new CommandRouter();
    router.command("help", () => { throw new Error("handler failed"); });
    const emitted = new Promise(resolve => router.once("commandError", resolve));

    const result = await router.handle(customCommand());
    assert.equal(result.status, "failed");
    assert.equal(result.error.message, "handler failed");
    assert.equal((await emitted).status, "failed");
});

test("webhook relay errors do not expose the webhook ID", async () => {
    const secret = "do-not-leak-this-webhook-id";
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        WEBHOOK_ID: secret,
        FETCH: async () => jsonResponse({ error: "failed" }, { status: 500 })
    });
    const result = await sdk.webhook.events();
    assert.equal(result.status, 500);
    assert.equal(JSON.stringify(result).includes(secret), false);
});

test("start requires Poll configuration and validates lifecycle options", async () => {
    const sdk = new LibertyJS({ SERVER_KEY: "server-secret" });
    await assert.rejects(() => sdk.commands.start(), /Poll transport is not configured/);
    const pollSdk = new LibertyJS({ SERVER_KEY: "server-secret", WEBHOOK_ID: "test" });
    await assert.rejects(() => pollSdk.commands.start({ pollInterval: 99 }), /at least 100/);
    await assert.rejects(() => sdk.commands.stop({ timeout: -1 }), /non-negative/);
});

test("stop cancels the next Poll request", async () => {
    let polls = 0;
    const router = new CommandRouter({
        pollEvents: async () => {
            polls++;
            return { events: [customCommand({ _id: "stop-event" })] };
        }
    });
    router.command("help", () => undefined);
    const handled = new Promise(resolve => router.once("handled", resolve));
    await router.start({ pollInterval: 100 });
    await handled;
    await router.stop();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(polls, 1);
    assert.equal(router.running, false);
});

test("an external abort signal stops Poll mode", async () => {
    const controller = new AbortController();
    const router = new CommandRouter({ pollEvents: async () => ({ events: [] }) });
    await router.start({ pollInterval: 100, signal: controller.signal });
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(router.running, false);
});

test("stop aborts an in-flight Poll fetch", async () => {
    let startFetch;
    const fetchStarted = new Promise(resolve => { startFetch = resolve; });
    let aborted = false;
    const sdk = new LibertyJS({
        SERVER_KEY: "abort-server-secret",
        WEBHOOK_ID: "abort-webhook",
        FETCH: async (_url, options) => {
            startFetch();
            return await new Promise((resolve, reject) => {
                options.signal.addEventListener("abort", () => {
                    aborted = true;
                    reject(new DOMException("Aborted", "AbortError"));
                }, { once: true });
            });
        }
    });

    await sdk.commands.start({ pollInterval: 100 });
    await fetchStarted;
    await sdk.commands.stop();
    assert.equal(aborted, true);
    assert.equal(sdk.commands.running, false);
});

test("validates command registration and outgoing messages", async () => {
    const router = new CommandRouter();
    assert.throws(() => router.command("two words", () => {}), /without whitespace/);
    assert.throws(() => router.command("help", "not a function"), /must be a function/);
    assert.throws(() => router.command("help", () => {}, { cooldown: -1 }), /non-negative/);

    const sdk = new LibertyJS({ SERVER_KEY: "server-secret" });
    sdk.commands.command("help", context => context.announce("x".repeat(201)));
    const result = await sdk.commands.handle(customCommand());
    assert.equal(result.status, "failed");
    assert.match(result.error.message, /200 characters or fewer/);
});
