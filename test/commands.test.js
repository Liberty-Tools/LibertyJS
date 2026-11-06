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

test("routes the current gateway's normalized CustomCommand envelope", async () => {
    const router = new CommandRouter();
    let context;
    router.command("help", value => { context = value; });
    const result = await router.handle({
        id: "evt_gateway", type: "CustomCommand", serverId: "server-1",
        occurredAt: "2026-10-27T12:00:00.000Z", receivedAt: "2026-10-27T12:00:01.000Z",
        data: { userId: "123", username: "Builder", command: "help", argument: "first second" }
    });
    assert.equal(result.status, "handled");
    assert.equal(context.userId, "123");
    assert.equal(context.serverId, "server-1");
    assert.deepEqual(context.args, ["first", "second"]);
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

test("v2 Poll mode acknowledges an event after its command handler completes", async () => {
    const calls = [];
    let acknowledgementDone;
    const acknowledged = new Promise(resolve => { acknowledgementDone = resolve; });
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
        FETCH: async (url, options) => {
            calls.push({ url: url.toString(), options });
            if (url.toString().endsWith("/events")) return jsonResponse({ events: [customCommand({ id: "event-1" })] });
            if (url.toString().endsWith("/acknowledge")) {
                acknowledgementDone();
                return jsonResponse({ acknowledged: ["event-1"] });
            }
            return jsonResponse({ message: "Success" });
        }
    });
    sdk.commands.command("help", () => "done");
    await sdk.commands.start({ pollInterval: 100 });
    await acknowledged;
    await sdk.commands.stop();
    const acknowledge = calls.find(call => call.url.endsWith("/acknowledge"));
    assert.ok(acknowledge);
    assert.equal(acknowledge.options.body, JSON.stringify({ eventIds: ["event-1"] }));
});

test("v2 Poll follows cursors so later events are not hidden by an earlier page", async () => {
    const reads = [];
    const acknowledged = [];
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const sdk = new LibertyJS({
        SERVER_KEY: "cursor-server-secret", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
        FETCH: async (url, options) => {
            const target = new URL(url);
            if (target.pathname.endsWith("/acknowledge")) {
                const ids = JSON.parse(options.body).eventIds;
                acknowledged.push(...ids);
                if (ids.includes("event-2")) finish();
                return jsonResponse({ acknowledged: ids });
            }
            reads.push(target.toString());
            return target.searchParams.get("cursor") === "next-page"
                ? jsonResponse({ events: [customCommand({ id: "event-2", _id: "event-2" })], hasMore: false })
                : jsonResponse({ events: [customCommand({ id: "event-1" })], hasMore: true, nextCursor: "next-page" });
        }
    });
    sdk.commands.command("help", () => undefined);
    await sdk.commands.start({ pollInterval: 100 });
    await finished;
    await sdk.commands.stop();
    assert.equal(reads[1].includes("cursor=next-page"), true);
    assert.deepEqual(acknowledged, ["event-1", "event-2"]);
});

test("failed handlers remain pending and are retried before acknowledgement", async () => {
    let attempts = 0;
    const acknowledgements = [];
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const router = new CommandRouter({
        pollEvents: async () => ({ events: [customCommand({ id: "event-1" })] }),
        acknowledgeEvents: async ids => { acknowledgements.push(ids); finish(); return { acknowledged: ids }; }
    });
    router.command("help", () => {
        attempts++;
        if (attempts === 1) throw new Error("temporary failure");
    }, { cooldown: 10_000 });
    await router.start({ pollInterval: 100 });
    await finished;
    await router.stop();
    assert.equal(attempts, 2);
    assert.deepEqual(acknowledgements, [["event-1"]]);
});

test("permanent handler failures with cooldowns stay pending between Poll reads", async t => {
    let now = 1_000;
    t.mock.method(Date, "now", () => now);
    let polls = 0;
    let attempts = 0;
    const acknowledgements = [];
    const controller = new AbortController();
    const router = new CommandRouter({
        pollEvents: async () => {
            if (++polls === 4) controller.abort();
            // Move past each retry backoff so every read can retry the handler.
            now += 5_000;
            return { events: [customCommand({ id: "permanent" })] };
        },
        acknowledgeEvents: async ids => { acknowledgements.push(ids); }
    });
    router.command("help", () => { attempts++; throw new Error("still unavailable"); }, { cooldown: 10_000 });
    try {
        await router.start({ pollInterval: 100, signal: controller.signal });
        while (router.running) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(attempts, 3);
        assert.deepEqual(acknowledgements, []);
    } finally {
        await router.stop();
    }
});

test("acknowledgement failure does not rerun a successful handler", async () => {
    let attempts = 0;
    let acks = 0;
    const controller = new AbortController();
    const router = new CommandRouter({
        pollEvents: async () => ({ events: [customCommand({ id: "ack-retry" })] }),
        acknowledgeEvents: async () => {
            if (++acks === 1) return { error: "network-error" };
            controller.abort();
            return { acknowledged: ["ack-retry"] };
        }
    });
    router.command("help", () => { attempts++; }, { cooldown: 10_000 });
    try {
        await router.start({ pollInterval: 100, signal: controller.signal });
        while (router.running) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(attempts, 1);
        assert.equal(acks, 2);
    } finally {
        await router.stop();
    }
});

test("concurrent duplicate deliveries wait for the original failure", async () => {
    let rejectHandler;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let attempts = 0;
    const router = new CommandRouter();
    router.command("help", () => {
        attempts++;
        started();
        return new Promise((resolve, reject) => { rejectHandler = reject; });
    }, { cooldown: 10_000 });
    const original = router.handle(customCommand());
    await ready;
    const duplicate = router.handle(customCommand());
    rejectHandler(new Error("temporary failure"));
    assert.equal((await original).status, "failed");
    assert.equal((await duplicate).status, "failed");
    assert.equal(attempts, 1);
});

test("an older failure cannot clear a newer cooldown or be acknowledged by it", async t => {
    let now = 1_000;
    t.mock.method(Date, "now", () => now);
    let rejectFirst;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let firstAttempts = 0;
    const router = new CommandRouter();
    router.command("help", context => {
        if (context.event.id === "older" && ++firstAttempts === 1) {
            started();
            return new Promise((resolve, reject) => { rejectFirst = reject; });
        }
    }, { cooldown: 100 });
    const older = router.handle(customCommand({ id: "older" }));
    await ready;
    now = 1_200;
    assert.equal((await router.handle(customCommand({ id: "newer" }))).status, "handled");
    rejectFirst(new Error("late failure"));
    assert.equal((await older).status, "failed");
    assert.equal((await router.handle(customCommand({ id: "older" }))).status, "failed");
    assert.equal((await router.handle(customCommand({ id: "third" }))).status, "cooldown");
    now = 2_400; // past both the cooldown and the first retry backoff
    assert.equal((await router.handle(customCommand({ id: "older" }))).status, "handled");
    assert.equal(firstAttempts, 2);
});

test("v2 Poll listEvents passes cursor and limit to the gateway", async () => {
    let requested;
    const sdk = new LibertyJS({
        SERVER_KEY: "options-server-secret", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
        FETCH: async url => { requested = new URL(url); return jsonResponse({ events: [] }); }
    });
    await sdk.webhook.listEvents({ cursor: "opaque/value", limit: 100 });
    assert.equal(requested.searchParams.get("cursor"), "opaque/value");
    assert.equal(requested.searchParams.get("limit"), "100");
    await assert.rejects(sdk.webhook.listEvents({ limit: 101 }), /limit must be an integer/);
});

test("a slow Poll request does not hold up an ER:LC command", async () => {
    let releasePoll;
    let pollStarted;
    const started = new Promise(resolve => { pollStarted = resolve; });
    const sdk = new LibertyJS({
        SERVER_KEY: "independent-server-secret", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
        FETCH: async (url, options) => {
            if (new URL(url).hostname === "api.libertytools.dev") {
                pollStarted();
                return await new Promise(resolve => { releasePoll = resolve; });
            }
            assert.equal(options.method, "POST");
            return jsonResponse({ message: "Success" });
        }
    });
    const poll = sdk.webhook.events();
    await started;
    const command = await Promise.race([
        sdk.sendPrivateServerCommand([":h still works"]),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Command was blocked by Poll")), 500))
    ]);
    assert.equal(command.successes, 1);
    releasePoll(jsonResponse({ events: [] }));
    await poll;
});

test("stopping the bot cancels a Poll Retry-After wait", async () => {
    let firstRequest;
    const requested = new Promise(resolve => { firstRequest = resolve; });
    let polls = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "retry-server-secret", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
        FETCH: async () => {
            polls++;
            firstRequest();
            return jsonResponse({ error: { code: "rate_limited" } }, {
                status: 429, headers: { "Retry-After": "30" }
            });
        }
    });
    await sdk.commands.start();
    await requested;
    await sdk.commands.stop({ timeout: 1_000 });
    assert.equal(sdk.commands.running, false);
    assert.equal(polls, 1);
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

test("reply targets the triggering user ID even if the event username is stale", async () => {
    let sent;
    const router = new CommandRouter({
        getServer: async () => ({ Players: [{ Player: "CurrentPlayer:123" }] }),
        sendCommands: async commands => { sent = commands[0]; return { successes: 1 }; }
    });
    router.command("help", context => context.reply("Hello"));
    const result = await router.handle(customCommand({ username: "OtherPlayer" }));
    assert.equal(result.status, "handled");
    assert.equal(sent, ":pm CurrentPlayer Hello");
});

test("reply and announce report an ERLC rejection as an error", async () => {
    const rejected = { successes: 0, failures: 1, failureReasons: [{ command: ":h Hi", status: 422 }], results: [] };
    const router = new CommandRouter({
        getServer: async () => ({ Players: [{ Player: "CurrentPlayer:123" }] }),
        sendCommands: async () => rejected
    });
    router.command("help", async context => [await context.reply("Hi"), await context.announce("Hi")]);
    const { value } = await router.handle(customCommand());
    for (const result of value) {
        assert.equal(result.error, "command_failed");
        assert.equal(result.failures, 1);
        assert.deepEqual(result.failureReasons, rejected.failureReasons);
    }
});

test("a successful reply has no error field", async () => {
    const router = new CommandRouter({
        getServer: async () => ({ Players: [{ Player: "CurrentPlayer:123" }] }),
        sendCommands: async () => ({ successes: 1, failures: 0, failureReasons: [], results: [] })
    });
    router.command("help", context => context.reply("Hi"));
    const { value } = await router.handle(customCommand());
    assert.equal("error" in value, false);
});

test("failed handlers back off before retrying", async t => {
    let now = 1_000;
    t.mock.method(Date, "now", () => now);
    let attempts = 0;
    const router = new CommandRouter();
    router.command("help", () => { attempts++; throw new Error("down"); });
    const first = await router.handle(customCommand());
    assert.equal(first.attempts, 1);
    assert.equal(first.willRetry, true);
    assert.equal(first.retryAt, 2_000);
    now = 1_999;
    assert.equal((await router.handle(customCommand())).attempts, 1);
    assert.equal(attempts, 1);
    now = 2_000;
    const second = await router.handle(customCommand());
    assert.equal(second.attempts, 2);
    assert.equal(second.retryAt, 4_000);
    assert.equal(attempts, 2);
});

test("a handler stops retrying after maxAttempts and Poll acknowledges it", async t => {
    let now = 1_000;
    t.mock.method(Date, "now", () => now);
    let attempts = 0;
    let polls = 0;
    const acknowledgements = [];
    const failures = [];
    const controller = new AbortController();
    const router = new CommandRouter({
        pollEvents: async () => {
            if (++polls === 6) controller.abort();
            now += 120_000; // past the longest backoff
            return { events: [customCommand({ id: "broken" })] };
        },
        acknowledgeEvents: async ids => { acknowledgements.push(ids); return { acknowledged: ids }; }
    });
    router.on("commandError", result => failures.push(result));
    router.command("help", () => { attempts++; throw new Error("always fails"); }, { maxAttempts: 3 });
    try {
        await router.start({ pollInterval: 100, signal: controller.signal });
        while (router.running) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(attempts, 3);
        assert.deepEqual(failures.map(result => result.willRetry), [true, true, false]);
        assert.equal(failures[2].retryAt, undefined);
        // Reads 3-5 return the final failure without rerunning it, and acknowledge it.
        assert.deepEqual(acknowledgements, [["broken"], ["broken"], ["broken"]]);
    } finally {
        await router.stop();
    }
});

test("maxAttempts must be a positive integer", () => {
    const router = new CommandRouter();
    for (const maxAttempts of [0, -1, 1.5, Infinity, "3"]) {
        assert.throws(() => router.command("help", () => undefined, { maxAttempts }), /maxAttempts/);
    }
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
    const timestamp = String(Math.floor(Date.now() / 1_000));
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
    const oldTimestamp = String(Math.floor(Date.now() / 1_000) - 600);
    const oldSignature = sign(null, Buffer.concat([Buffer.from(oldTimestamp), rawBody]), privateKey).toString("hex");
    assert.deepEqual(await sdk.commands.handleWebhook({ timestamp: oldTimestamp, signature: oldSignature, rawBody }),
        { status: "rejected", reason: "invalid_signature" });
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

function signedWebhookFixture() {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const sdk = new LibertyJS({
        SERVER_KEY: "signed-batch-server",
        WEBHOOK_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).toString("base64")
    });
    function delivery(payload, timestamp = String(Math.floor(Date.now() / 1_000))) {
        const rawBody = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
        return { timestamp, rawBody, signature: sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("hex") };
    }
    return { sdk, delivery };
}

test("signed ERLC batches preserve identity, order, arguments, and replay IDs", async () => {
    const { sdk, delivery } = signedWebhookFixture();
    const received = [];
    sdk.commands.command("help", context => { received.push(context); });
    const input = delivery({
        server: "server-batch",
        events: [
            { event: "WebhookProbe", origin: "global", data: {} },
            { event: "CustomCommand", origin: "123", data: { command: "help", argument: 'Player "final warning"' } },
            { event: "FutureEvent", data: {} },
            { event: "CustomCommand", origin: "123", data: { command: "help", argument: 'Player "final warning"' } }
        ]
    });
    const first = await sdk.commands.handleWebhook(input);
    assert.equal(first.status, "batch");
    assert.deepEqual(first.results.map(result => result.status), ["ignored", "handled", "ignored", "handled"]);
    assert.equal(received.length, 2);
    assert.equal(received[0].userId, "123");
    assert.equal(received[0].serverId, "server-batch");
    assert.deepEqual(received[0].args, ["Player", "final warning"]);
    assert.notEqual(received[0].event.id, received[1].event.id);
    const replay = await sdk.commands.handleWebhook(input);
    assert.deepEqual(replay.results.map(result => result.status), ["ignored", "duplicate", "ignored", "duplicate"]);
    assert.equal(received.length, 2);
});

test("signed individual raw events map origin and preserve existing single results", async () => {
    const { sdk, delivery } = signedWebhookFixture();
    let context;
    sdk.commands.command("help", value => { context = value; });
    const result = await sdk.commands.handleWebhook(delivery({
        event: "CustomCommand", origin: 123, server: "single-server", data: { command: "help", argument: "" }
    }));
    assert.equal(result.status, "handled");
    assert.equal(context.userId, "123");
    assert.equal(context.serverId, "single-server");
});

test("a batch verifies its original bytes once and supports ArrayBuffer bodies", async () => {
    const { sdk, delivery } = signedWebhookFixture();
    let verifications = 0;
    let handled = 0;
    const router = new CommandRouter({ verifyWebhook: input => {
        verifications++;
        return sdk.verifyWebhook(input);
    } });
    router.command("help", () => { handled++; });
    const input = delivery(' { "server": "batch", "events": [\n' +
        '{"event":"CustomCommand","origin":"1","data":{"command":"help"}},' +
        '{"event":"CustomCommand","origin":"2","data":{"command":"help"}}] } ');
    input.rawBody = Uint8Array.from(input.rawBody).buffer;
    assert.equal((await router.handleWebhook(input)).status, "batch");
    assert.equal(verifications, 1);
    assert.equal(handled, 2);
});

test("invalid or stale signatures reject an entire batch before any handler", async () => {
    const { sdk, delivery } = signedWebhookFixture();
    let calls = 0;
    sdk.commands.command("help", () => { calls++; });
    const payload = { server: "batch", events: [{ event: "CustomCommand", origin: "123", data: { command: "help" } }] };
    const input = delivery(payload);
    for (const invalid of [
        { ...input, signature: "00" },
        { ...input, rawBody: Buffer.from(JSON.stringify({ ...payload, server: "tampered" })) },
        delivery(payload, String(Math.floor(Date.now() / 1_000) - 600))
    ]) assert.deepEqual(await sdk.commands.handleWebhook(invalid), { status: "rejected", reason: "invalid_signature" });
    assert.equal(calls, 0);
});

test("malformed signed batches are rejected before any partial processing", async () => {
    const { sdk, delivery } = signedWebhookFixture();
    let calls = 0;
    sdk.commands.command("help", () => { calls++; });
    const valid = { event: "CustomCommand", origin: "123", data: { command: "help" } };
    for (const payload of [
        { events: null }, { events: {} }, { events: [valid], server: {} }, { events: [valid, null] },
        { events: [valid, []] }, { events: [valid, {}] },
        { events: [valid, { ...valid, data: { command: {} } }] },
        { events: [valid, { ...valid, origin: {} }] }
    ]) assert.deepEqual(await sdk.commands.handleWebhook(delivery(payload)), { status: "rejected", reason: "invalid_payload" });
    assert.deepEqual(await sdk.commands.handleWebhook(delivery("{")), { status: "rejected", reason: "invalid_json" });
    assert.deepEqual(await sdk.commands.handleWebhook(delivery({ events: [] })), { status: "batch", results: [] });
    assert.equal(calls, 0);
});

test("mixed batch results retain successful work while retrying only failures", async t => {
    const { sdk, delivery } = signedWebhookFixture();
    const realNow = Date.now();
    let now = realNow;
    t.mock.method(Date, "now", () => now);
    let calls = 0;
    sdk.commands.command("help", context => {
        calls++;
        if (context.userId === "2" && calls === 2) throw new Error("temporary failure");
    });
    const input = delivery({ events: [
        { event: "CustomCommand", origin: "1", data: { command: "help" } },
        { event: "CustomCommand", origin: "2", data: { command: "help" } },
        { event: "CustomCommand", origin: "3", data: { command: "missing" } }
    ], server: "batch" });
    assert.deepEqual((await sdk.commands.handleWebhook(input)).results.map(result => result.status), ["handled", "failed", "unhandled"]);
    now = realNow + 2_000; // past the retry backoff, still inside the signature window
    assert.deepEqual((await sdk.commands.handleWebhook(input)).results.map(result => result.status), ["duplicate", "handled", "duplicate"]);
    assert.equal(calls, 3);
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

test("webhook relay network failures do not expose a URL embedded in the cause", async () => {
    const secret = "private-relay-token";
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret", WEBHOOK_ID: secret,
        FETCH: async url => { throw new Error(`Failed to fetch ${url}`); }
    });
    const result = await sdk.webhook.events();
    assert.equal(result.error, "network-error");
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
    let pollErrors = 0;
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
    sdk.commands.on("pollError", () => { pollErrors++; });

    await sdk.commands.start({ pollInterval: 100 });
    await fetchStarted;
    await sdk.commands.stop();
    assert.equal(aborted, true);
    assert.equal(sdk.commands.running, false);
    assert.equal(pollErrors, 0);
});

test("a timed-out stop cannot start an overlapping Poll loop", async () => {
    let firstPollStarted;
    const started = new Promise(resolve => { firstPollStarted = resolve; });
    let releaseFirst;
    let polls = 0;
    const router = new CommandRouter({ pollEvents: async () => {
        polls++;
        if (polls === 1) {
            firstPollStarted();
            return await new Promise(resolve => { releaseFirst = resolve; });
        }
        return { events: [] };
    } });
    await router.start({ pollInterval: 1_000 });
    await started;
    await assert.rejects(router.stop({ timeout: 10 }), /Timed out/);
    await router.start();
    assert.equal(polls, 1);
    releaseFirst({ events: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(router.running, false);
    await router.start({ pollInterval: 1_000 });
    assert.equal(polls, 2);
    await router.stop();
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
