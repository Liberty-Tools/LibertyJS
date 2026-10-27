// Use the public package export so packaging/resolution mistakes fail this check.
import LibertyJS, {
    DEFAULT_WEBHOOK_RELAY_URL, ERLC_WEBHOOK_PUBLIC_KEY,
    type LibertyError, type ServerOption, type CommandSummary,
    type CommandContext, type CommandHandleResult, CommandRouter
} from "@libertytools/libertyjs";

const sdk = new LibertyJS({
    SERVER_KEY: "test-only", GLOBAL_API_KEY: "global", AUTHORIZATION: "global",
    PRIVATE_SERVER_API: "https://example.test/", WEBHOOK_URL: DEFAULT_WEBHOOK_RELAY_URL,
    WEBHOOK_ID: "test", WEBHOOK_TOKEN: "test", WEBHOOK_PUBLIC_KEY: ERLC_WEBHOOK_PUBLIC_KEY,
    MAX_RATE_LIMIT_RETRIES: 0, FETCH: async () => new Response("null")
});
const v2PollSdk = new LibertyJS({
    SERVER_KEY: "test-only", POLL_SUBSCRIPTION_ID: "sub_1", POLL_TOKEN: "ltp_token",
    WEBHOOK_INGEST_URL: "https://api.example.test/v1/ingest/pub_1"
});
await v2PollSdk.webhook.acknowledge(["evt_1"]);
const options: ServerOption[] = ["Players", "Staff", "JoinLogs", "Queue", "KillLogs",
    "CommandLogs", "ModCalls", "EmergencyCalls", "Vehicles"];
const raw: unknown = await sdk.getPrivateServerAPI(options);
const detailed = await sdk.getPrivateServerAPI(options, true);
const invalid: unknown[] = detailed.invalidOptions;
const defaults = await sdk.getPrivateServerAPI(undefined, true);
const defaultData: unknown = defaults.data;
const flag: boolean = Math.random() > 0.5;
await sdk.getPrivateServerAPI(options, flag);

// Raw JSON must be validated before reading fields.
// @ts-expect-error API response is unvalidated
raw.Name;
const commands = await sdk.sendPrivateServerCommand([":h test"]);
if ("error" in commands) {
    const kind: "invalid_input" = commands.error;
} else {
    const summary: CommandSummary = commands;
    const count: number = summary.successes;
}
const url: string | null = sdk.webhook.erlcUrl();
const verified: boolean = sdk.webhook.verify({
    timestamp: "123", signature: "abcd", rawBody: Buffer.from("{}")
});
sdk.verifyWebhook({ rawBody: new ArrayBuffer(0) });
sdk.verifyWebhook({ rawBody: new Uint8Array(0) });
sdk.verifyWebhook({ rawBody: "{}", publicKey: ERLC_WEBHOOK_PUBLIC_KEY });
sdk.verifyWebhook();
await sdk.webhook.status();
await sdk.webhook.events();
await sdk.webhook.listEvents({ signal: new AbortController().signal });
await v2PollSdk.webhook.listEvents({ cursor: "opaque", limit: 100 });
sdk.commands.command(";help", async (context: CommandContext) => {
    const command: string = context.command;
    const argument: string = context.argument;
    const args: string[] = context.args;
    const userId: string = context.userId;
    const serverId: string = context.serverId;
    await context.reply(`${command} ${argument} ${args.length} ${userId} ${serverId}`);
    return context.announce("Hello server");
}, { cooldown: 10_000 });
const manualResult: CommandHandleResult = await sdk.commands.handle({
    event: "CustomCommand", command: "help", argument: "", userId: "1"
});
await sdk.commands.handleWebhook({ timestamp: "1", signature: "00", rawBody: "{}" });
await sdk.commands.start({ pollInterval: 2_000, signal: new AbortController().signal });
const running: boolean = sdk.commands.running;
await sdk.commands.stop({ timeout: 1_000 });
const removed: boolean = sdk.commands.remove("help");
const standalone: CommandRouter = new CommandRouter({ maxSeenEvents: 10 });
standalone.command("test", () => undefined);
function errorDetails(error: LibertyError): unknown {
    if (error.error === "network-error") return error.message;
    if (error.error === "api-error" || error.error === "rate-limited") return error.headers;
    return error.message;
}

// @ts-expect-error A server key is required
new LibertyJS();
// @ts-expect-error A server key must be a string
new LibertyJS({ SERVER_KEY: 123 });
// @ts-expect-error Reject misspelled query options
sdk.getPrivateServerAPI(["Player"]);
// @ts-expect-error Options must be an array
sdk.getPrivateServerAPI("Players");
// @ts-expect-error Commands must contain strings
sdk.sendPrivateServerCommand([123]);
// @ts-expect-error Raw JSON objects are not signed request bytes
sdk.webhook.verify({ rawBody: { event: "CustomCommand" } });
// @ts-expect-error Command handlers must be functions
sdk.commands.command("help", "reply");
// @ts-expect-error Cooldown must be numeric
sdk.commands.command("help", () => undefined, { cooldown: "10s" });
// @ts-expect-error Poll page size must be numeric
v2PollSdk.webhook.events({ limit: "50" });
