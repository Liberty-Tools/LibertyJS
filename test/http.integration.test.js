import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";

// The optional override also runs this suite against an installed npm tarball.
const { default: LibertyJS } = await import(process.env.LIBERTYJS_TEST_MODULE || "../src/index.js");

function json(res, value, status = 200, headers = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(value));
}

async function body(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function listen(t, handler) {
    const errors = [];
    const server = createServer((req, res) => {
        Promise.resolve().then(() => handler(req, res)).catch(error => {
            errors.push(error);
            if (!res.headersSent) json(res, { error: "test_server_failure" }, 500);
            else res.destroy();
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    t.after(async () => {
        await new Promise(resolve => {
            server.close(resolve);
            server.closeAllConnections();
        });
        assert.deepEqual(errors, [], "HTTP handler assertions must pass");
    });
    return `http://127.0.0.1:${server.address().port}`;
}

function transport(origin) {
    // Keep the official URL visible to the SDK's authentication/rate-limit
    // logic, then send actual HTTP bytes only to this disposable local server.
    return (url, options) => {
        const target = new URL(url);
        assert.ok(["api.erlc.gg", "api.libertytools.dev"].includes(target.hostname));
        return fetch(`${origin}${target.pathname}${target.search}`, options);
    };
}

async function until(predicate) {
    const deadline = Date.now() + 4_000;
    while (!predicate()) {
        assert.ok(Date.now() < deadline, "Timed out waiting for the HTTP flow");
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

test("HTTP Poll -> player lookup -> private reply -> acknowledgement, including failed ack", { timeout: 8_000 }, async t => {
    let commands = 0;
    let acknowledgements = 0;
    let finished = false;
    const origin = await listen(t, async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (url.pathname.startsWith("/v1/poll/")) {
            assert.equal(req.headers.authorization, "Bearer integration-poll-token");
            assert.equal(req.headers["server-key"], undefined);
            if (req.method === "POST") {
                const payload = JSON.parse((await body(req)).toString());
                assert.deepEqual(payload.eventIds, ["evt_http"]);
                assert.equal(commands, 1, "Acknowledge only after sending the reply");
                if (++acknowledgements === 1) return json(res, {}, 503);
                finished = true;
                return json(res, { acknowledged: ["evt_http"] });
            }
            return json(res, { events: [{ id: "evt_http", type: "CustomCommand", serverId: "http-server", data: { userId: "123", command: "help", argument: "" } }] });
        }
        assert.equal(req.headers["server-key"], "integration-server-key");
        assert.equal(req.headers.authorization, "integration-global-key");
        if (req.method === "GET") {
            assert.equal(url.searchParams.get("Players"), "true");
            return json(res, { Players: [{ Player: "HttpPlayer:123" }] });
        }
        assert.equal(url.pathname, "/v2/server/command");
        assert.deepEqual(JSON.parse((await body(req)).toString()), { command: ":pm HttpPlayer HTTP test passed" });
        commands++;
        return json(res, { message: "Success" });
    });
    const sdk = new LibertyJS({ SERVER_KEY: "integration-server-key", GLOBAL_API_KEY: "integration-global-key", POLL_SUBSCRIPTION_ID: "sub_http", POLL_TOKEN: "integration-poll-token", FETCH: transport(origin) });
    t.after(() => sdk.commands.stop());
    sdk.commands.command("help", async context => {
        const result = await context.reply("HTTP test passed");
        assert.equal(result.failures, 0);
    }, { cooldown: 10_000 });
    await sdk.commands.start({ pollInterval: 100 });
    await until(() => finished);
    await sdk.commands.stop();
    assert.equal(commands, 1);
    assert.equal(acknowledgements, 2);
});

test("HTTP Poll retries a failed cooldown handler and drains cursor pages", { timeout: 8_000 }, async t => {
    let attempts = 0;
    const acknowledged = new Set();
    const cursors = [];
    const origin = await listen(t, async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        if (req.method === "POST") {
            const ids = JSON.parse((await body(req)).toString()).eventIds;
            for (const id of ids) acknowledged.add(id);
            if (ids.includes("first")) assert.equal(attempts, 2);
            return json(res, { acknowledged: ids });
        }
        const cursor = url.searchParams.get("cursor");
        cursors.push(cursor);
        const id = cursor === "page-2" ? "second" : "first";
        return json(res, {
            events: acknowledged.has(id) ? [] : [{ id, type: "CustomCommand", data: { command: id, userId: "123" } }],
            hasMore: cursor === null, nextCursor: cursor === null ? "page-2" : null
        });
    });
    const sdk = new LibertyJS({ SERVER_KEY: "cursor-http-key", POLL_SUBSCRIPTION_ID: "sub_cursor", POLL_TOKEN: "cursor-token", FETCH: transport(origin) });
    t.after(() => sdk.commands.stop());
    sdk.commands.command("first", () => { if (++attempts === 1) throw new Error("temporary failure"); }, { cooldown: 10_000 });
    sdk.commands.command("second", () => {});
    await sdk.commands.start({ pollInterval: 100 });
    await until(() => acknowledged.size === 2);
    await sdk.commands.stop();
    assert.deepEqual([...acknowledged], ["second", "first"]);
    assert.deepEqual(cursors.slice(0, 3), [null, "page-2", null]);
});

test("HTTP 429 retries honor Retry-After and do not duplicate accepted commands", { timeout: 5_000 }, async t => {
    const times = [];
    let accepted = 0;
    const origin = await listen(t, async (req, res) => {
        await body(req);
        times.push(Date.now());
        if (times.length === 1) return json(res, { retry_after: 0.1 }, 429, { "Retry-After": "0.1" });
        accepted++;
        return json(res, { message: "Success" });
    });
    const sdk = new LibertyJS({ SERVER_KEY: "retry-http-key", FETCH: transport(origin) });
    const result = await sdk.sendPrivateServerCommand([":h Test"]);
    assert.equal(result.successes, 1);
    assert.equal(accepted, 1);
    assert.equal(times.length, 2);
    assert.ok(times[1] - times[0] >= 90);
});

test("HTTP ERLC auth cutoff leaves real Poll requests and credentials independent", { timeout: 5_000 }, async t => {
    let erlcCalls = 0;
    let relayCalls = 0;
    const origin = await listen(t, (req, res) => {
        if (req.url.startsWith("/v2/")) {
            erlcCalls++;
            return json(res, { code: 2003 }, 403);
        }
        relayCalls++;
        assert.equal(req.headers.authorization, "Bearer auth-http-token");
        assert.equal(req.headers["server-key"], undefined);
        return json(res, { events: [] });
    });
    const sdk = new LibertyJS({ SERVER_KEY: "auth-http-key", GLOBAL_API_KEY: "auth-global-key", POLL_SUBSCRIPTION_ID: "sub_auth", POLL_TOKEN: "auth-http-token", FETCH: transport(origin) });
    for (let index = 0; index < 3; index++) {
        await sdk.getPrivateServerAPI();
        assert.deepEqual(await sdk.webhook.events(), { events: [] });
    }
    assert.equal((await sdk.getPrivateServerAPI()).error, "forbidden");
    assert.deepEqual(await sdk.webhook.events(), { events: [] });
    assert.equal(erlcCalls, 3);
    assert.equal(relayCalls, 4);
});

test("HTTP signed receiver rejects tampering, routes batches, and suppresses replay", { timeout: 5_000 }, async t => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const sdk = new LibertyJS({ SERVER_KEY: "receiver-key", WEBHOOK_PUBLIC_KEY: publicKey.export({ format: "der", type: "spki" }).toString("base64") });
    const received = [];
    sdk.commands.command("help", context => { received.push([context.userId, context.serverId]); });
    const origin = await listen(t, async (req, res) => {
        const result = await sdk.commands.handleWebhook({ timestamp: req.headers["x-signature-timestamp"], signature: req.headers["x-signature-ed25519"], rawBody: await body(req) });
        return json(res, result, result.status === "rejected" ? 400 : 200);
    });
    const rawBody = JSON.stringify({ server: "signed-http", events: [
        { event: "WebhookProbe", origin: "global", data: {} },
        { event: "CustomCommand", origin: "123", data: { command: "help" } }
    ] });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), Buffer.from(rawBody)]), privateKey).toString("hex");
    const headers = { "Content-Type": "application/json", "X-Signature-Timestamp": timestamp, "X-Signature-Ed25519": signature };
    const altered = await fetch(origin, { method: "POST", headers, body: rawBody.replace("123", "456") });
    assert.equal(altered.status, 400);
    assert.deepEqual(received, []);
    for (const expected of ["handled", "duplicate"]) {
        const response = await fetch(origin, { method: "POST", headers, body: rawBody });
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.deepEqual(result.results.map(item => item.status), ["ignored", expected]);
    }
    assert.deepEqual(received, [["123", "signed-http"]]);
});

test("HTTP connection failure is not automatically retried for a command", { timeout: 5_000 }, async t => {
    let requests = 0;
    const origin = await listen(t, async (req, res) => {
        await body(req);
        requests++;
        res.destroy();
    });
    const sdk = new LibertyJS({ SERVER_KEY: "disconnect-key", FETCH: transport(origin) });
    const result = await sdk.sendPrivateServerCommand([":h Test"]);
    assert.equal(result.failures, 1);
    assert.equal(result.results[0].response.error, "network-error");
    assert.equal(requests, 1);
});

test("HTTP Poll shutdown cancels an unfinished response body without reporting an error", { timeout: 5_000 }, async t => {
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    let closed = false;
    let errors = 0;
    const origin = await listen(t, (req, res) => {
        res.once("close", () => { closed = true; });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write('{"events":');
        started();
    });
    const sdk = new LibertyJS({ SERVER_KEY: "body-abort-key", POLL_SUBSCRIPTION_ID: "sub_abort", POLL_TOKEN: "body-abort-token", FETCH: transport(origin) });
    t.after(() => sdk.commands.stop());
    sdk.commands.on("pollError", () => { errors++; });
    await sdk.commands.start();
    await ready;
    await sdk.commands.stop({ timeout: 1_000 });
    await until(() => closed);
    assert.equal(sdk.commands.running, false);
    assert.equal(errors, 0);
});

test("HTTP truncated successful response cannot falsely report command success", { timeout: 5_000 }, async t => {
    let requests = 0;
    const origin = await listen(t, async (req, res) => {
        await body(req);
        requests++;
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "100" });
        res.write('{"message":');
        setTimeout(() => res.destroy(), 10);
    });
    const sdk = new LibertyJS({ SERVER_KEY: "truncated-key", FETCH: transport(origin) });
    const result = await sdk.sendPrivateServerCommand([":h Test"]);
    assert.equal(result.successes, 0);
    assert.equal(result.failures, 1);
    assert.equal(requests, 1, "Do not replay a possibly accepted command");
});

test("HTTP invalid JSON cannot report success, while empty 204 responses remain valid", { timeout: 5_000 }, async t => {
    let requests = 0;
    const origin = await listen(t, async (req, res) => {
        await body(req);
        if (++requests === 1) {
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end("<html>Unexpected upstream page</html>");
        }
        res.writeHead(204);
        res.end();
    });
    const sdk = new LibertyJS({ SERVER_KEY: "invalid-json-key", FETCH: transport(origin) });
    const invalid = await sdk.sendPrivateServerCommand([":h First"]);
    assert.equal(invalid.successes, 0);
    assert.equal(invalid.failures, 1);
    const empty = await sdk.sendPrivateServerCommand([":h Second"]);
    assert.equal(empty.successes, 1);
    assert.equal(requests, 2);
});

test("HTTP non-JSON errors preserve their status and rate-limit retry headers", { timeout: 5_000 }, async t => {
    let requests = 0;
    const origin = await listen(t, async (req, res) => {
        await body(req);
        requests++;
        res.writeHead(requests === 1 ? 429 : 503, { "Content-Type": "text/html", "Retry-After": "0" });
        res.end("<html>Upstream unavailable</html>");
    });
    const sdk = new LibertyJS({ SERVER_KEY: "html-error-key", MAX_RATE_LIMIT_RETRIES: 1, FETCH: transport(origin) });
    const result = await sdk.getPrivateServerAPI();
    assert.equal(requests, 2);
    assert.equal(result.error, "api-error");
    assert.equal(result.status, 503);
    assert.equal(result.apiResponse, null);
});
