import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import LibertyJS from "../src/index.js";

function jsonResponse(data, init = {}) {
    return new Response(JSON.stringify(data), {
        status: init.status || 200,
        statusText: init.statusText,
        headers: { "Content-Type": "application/json", ...init.headers }
    });
}

test("requests all v2 server fields and sends both authentication headers", async () => {
    const calls = [];
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        GLOBAL_API_KEY: "global-secret",
        FETCH: async (url, options) => {
            calls.push({ url, options });
            return jsonResponse({ Name: "Test" });
        }
    });

    const response = await sdk.getPrivateServerAPI([
        "Players", "Staff", "JoinLogs", "Queue", "KillLogs", "CommandLogs",
        "ModCalls", "EmergencyCalls", "Vehicles", "Players", "NotReal"
    ], true);

    assert.equal(response.data.Name, "Test");
    assert.deepEqual(response.invalidOptions, ["NotReal"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers.get("server-key"), "server-secret");
    assert.equal(calls[0].options.headers.get("Authorization"), "global-secret");
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/v2/server");
    assert.equal(url.searchParams.get("EmergencyCalls"), "true");
    assert.equal(url.searchParams.getAll("Players").length, 1);
});

test("sends API-compliant command objects without a stale allowlist", async () => {
    const calls = [];
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async (url, options) => {
            calls.push({ url, options });
            return jsonResponse({ message: "Success" });
        }
    });

    const response = await sdk.sendPrivateServerCommand([":h Hello!", ":futurecommand value"]);

    assert.equal(response.successes, 2);
    assert.equal(response.failures, 0);
    assert.equal(calls[0].options.body, JSON.stringify({ command: ":h Hello!" }));
    assert.equal(calls[0].options.headers.get("Content-Type"), "application/json");
    assert.equal(calls[1].options.body, JSON.stringify({ command: ":futurecommand value" }));
});

test("reports invalid command values instead of throwing or silently discarding them", async () => {
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async () => jsonResponse({ message: "Success" })
    });
    const response = await sdk.sendPrivateServerCommand([null, "  ", ":h valid"]);
    assert.equal(response.successes, 1);
    assert.equal(response.failures, 2);
    assert.equal(response.failureReasons.length, 2);
});

test("honors a 429 Retry-After response and retries", async () => {
    let calls = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        MAX_RATE_LIMIT_RETRIES: 1,
        FETCH: async () => {
            calls++;
            if (calls === 1) {
                return jsonResponse({ retry_after: 0 }, {
                    status: 429,
                    headers: { "Retry-After": "0", "X-RateLimit-Bucket": "global" }
                });
            }
            return jsonResponse({ Name: "Test" });
        }
    });
    const response = await sdk.getPrivateServerAPI();
    assert.equal(response.Name, "Test");
    assert.equal(calls, 2);
});

test("uses retry_after from the response body when the header is absent", async () => {
    let calls = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        MAX_RATE_LIMIT_RETRIES: 1,
        FETCH: async () => {
            calls++;
            return calls === 1
                ? jsonResponse({ retry_after: 0 }, { status: 429 })
                : jsonResponse({ Name: "Test" });
        }
    });
    const response = await sdk.getPrivateServerAPI();
    assert.equal(response.Name, "Test");
    assert.equal(calls, 2);
});

test("serializes concurrent requests so learned limits cannot be raced", async () => {
    let active = 0;
    let maximumActive = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async () => {
            active++;
            maximumActive = Math.max(maximumActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
            return jsonResponse({ Name: "Test" });
        }
    });
    await Promise.all([sdk.getPrivateServerAPI(), sdk.getPrivateServerAPI()]);
    assert.equal(maximumActive, 1);
});

test("coordinates concurrent requests across instances sharing a global API key", async () => {
    let active = 0;
    let maximumActive = 0;
    const fetch = async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return jsonResponse({ Name: "Test" });
    };
    const first = new LibertyJS({ SERVER_KEY: "server-one", GLOBAL_API_KEY: "shared-global-key", FETCH: fetch });
    const second = new LibertyJS({ SERVER_KEY: "server-two", GLOBAL_API_KEY: "shared-global-key", FETCH: fetch });

    await Promise.all([first.getPrivateServerAPI(), second.getPrivateServerAPI()]);
    assert.equal(maximumActive, 1);
});

test("applies a known global bucket before a route is seen for the first time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 1;
    let postStartedAt = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "global-route-server",
        GLOBAL_API_KEY: "global-route-key",
        FETCH: async (url, options) => {
            if (options.method === "GET") {
                return jsonResponse({ Name: "Test" }, {
                    headers: {
                        "X-RateLimit-Bucket": "global",
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": String(reset)
                    }
                });
            }
            postStartedAt = Date.now();
            return jsonResponse({ message: "Success" });
        }
    });

    await sdk.getPrivateServerAPI();
    await sdk.sendPrivateServerCommand([":h waits for global bucket"]);
    assert.ok(postStartedAt >= reset * 1000);
});

test("preserves HTTP status, error code, headers, and response body", async () => {
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        MAX_RATE_LIMIT_RETRIES: 0,
        FETCH: async () => jsonResponse({ code: 4001, message: "Slow down" }, {
            status: 429,
            headers: { "Retry-After": "5" }
        })
    });
    const response = await sdk.getPrivateServerAPI();
    assert.equal(response.error, "rate-limited");
    assert.equal(response.status, 429);
    assert.equal(response.code, 4001);
    assert.equal(response.retryAfter, 5);
    assert.equal(response.apiResponse.message, "Slow down");
});

test("normalizes network failures", async () => {
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        FETCH: async () => { throw new Error("connection failed"); }
    });
    const response = await sdk.getPrivateServerAPI();
    assert.equal(response.error, "network-error");
    assert.equal(response.cause, "connection failed");
});

test("stops after repeated invalid global API key responses", async () => {
    let calls = 0;
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        GLOBAL_API_KEY: "invalid-global-key",
        FETCH: async () => {
            calls++;
            return jsonResponse({ code: 2003, message: "Invalid global API key" }, { status: 403 });
        }
    });

    await sdk.getPrivateServerAPI();
    await sdk.getPrivateServerAPI();
    await sdk.getPrivateServerAPI();
    const blocked = await sdk.getPrivateServerAPI();
    assert.equal(calls, 3);
    assert.equal(blocked.error, "forbidden");
});

test("verifies official Ed25519 webhook signing format over timestamp + raw body", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const rawBody = Buffer.from('{"event":"CustomCommand"}');
    const timestamp = "1774666018";
    const signature = sign(null, Buffer.concat([Buffer.from(timestamp), rawBody]), privateKey).toString("hex");
    const sdk = new LibertyJS({ SERVER_KEY: "server-secret", WEBHOOK_PUBLIC_KEY: publicKeyBase64 });

    assert.equal(sdk.webhook.verify({ timestamp, signature, rawBody }), true);
    assert.equal(sdk.webhook.verify({ timestamp, signature, rawBody: Buffer.from("tampered") }), false);
});

test("integrates directly with Liberty Tools dashboard webhook IDs", async () => {
    const calls = [];
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        WEBHOOK_ID: "dashboard-webhook-id",
        FETCH: async (url, options) => {
            calls.push({ url: url.toString(), options });
            return jsonResponse({ ok: true });
        }
    });

    assert.equal(sdk.webhook.erlcUrl(), "https://api.libertytools.dev/webhook/dashboard-webhook-id");
    await sdk.webhook.status();
    await sdk.webhook.events();

    assert.deepEqual(calls.map(call => call.url), [
        "https://api.libertytools.dev/health",
        "https://api.libertytools.dev/webhook/dashboard-webhook-id/events"
    ]);
    assert.equal(calls[0].options.headers.has("server-key"), false);
    assert.equal(calls[1].options.headers.has("Authorization"), false);
});

test("accepts a full dashboard ER:LC webhook URL", () => {
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret",
        WEBHOOK_ID: "https://api.libertytools.dev/webhook/url-webhook-id"
    });
    assert.equal(sdk.webhook.erlcUrl(), "https://api.libertytools.dev/webhook/url-webhook-id");
});

test("supports v2 Poll subscriptions with bearer auth and acknowledgements", async () => {
    const calls = [];
    const sdk = new LibertyJS({
        SERVER_KEY: "server-secret", LIBERTY_API_URL: "https://api.libertytools.dev/",
        WEBHOOK_INGEST_URL: "https://api.libertytools.dev/v1/ingest/pub_123",
        POLL_SUBSCRIPTION_ID: "sub_123", POLL_TOKEN: "ltp_secret",
        FETCH: async (url, options) => {
            calls.push({ url: url.toString(), options });
            return jsonResponse(options.method === "POST" ? { acknowledged: ["evt_1"] } : { events: [{ id: "evt_1" }] });
        }
    });
    assert.equal(sdk.webhook.erlcUrl(), "https://api.libertytools.dev/v1/ingest/pub_123");
    await sdk.webhook.events();
    await sdk.webhook.acknowledge(["evt_1"]);
    assert.deepEqual(calls.map(call => call.url), [
        "https://api.libertytools.dev/v1/poll/subscriptions/sub_123/events",
        "https://api.libertytools.dev/v1/poll/subscriptions/sub_123/events/acknowledge"
    ]);
    assert.equal(calls[0].options.headers.get("Authorization"), "Bearer ltp_secret");
    assert.equal(calls[1].options.body, JSON.stringify({ eventIds: ["evt_1"] }));
});
