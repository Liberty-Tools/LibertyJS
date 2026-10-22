import { EventEmitter } from "node:events";

export type ServerOption =
    | "Players" | "Staff" | "JoinLogs" | "Queue" | "KillLogs"
    | "CommandLogs" | "ModCalls" | "EmergencyCalls" | "Vehicles";

export interface LibertyJSOptions {
    SERVER_KEY: string;
    GLOBAL_API_KEY?: string;
    /** Alias for GLOBAL_API_KEY. */
    AUTHORIZATION?: string;
    PRIVATE_SERVER_API?: string;
    WEBHOOK_URL?: string;
    /** Alias for WEBHOOK_ID. */
    WEBHOOK_TOKEN?: string;
    WEBHOOK_ID?: string;
    /** Full ER:LC ingest URL shown by the Liberty Tools dashboard. */
    WEBHOOK_INGEST_URL?: string;
    /** v2 Poll subscription ID shown by the dashboard. */
    POLL_SUBSCRIPTION_ID?: string;
    /** One-time v2 Poll token shown by the dashboard. */
    POLL_TOKEN?: string;
    /** Liberty Tools API base URL. */
    LIBERTY_API_URL?: string;
    /** Base64 DER/SPKI Ed25519 public key. */
    WEBHOOK_PUBLIC_KEY?: string;
    MAX_RATE_LIMIT_RETRIES?: number;
    FETCH?: typeof globalThis.fetch;
}

export interface WebhookVerificationInput {
    timestamp?: string;
    signature?: string;
    /** Exact request bytes; Node.js Buffer is also accepted. */
    rawBody?: string | Uint8Array | ArrayBuffer;
    publicKey?: string;
}

export interface HTTPError {
    error: "api-error" | "rate-limited";
    message: string;
    status: number;
    statusText: string;
    code?: unknown;
    retryAfter?: number;
    headers: Record<string, string>;
    apiResponse: unknown;
}

export type LibertyError = HTTPError | {
    error: "network-error";
    message: string;
} | {
    error: "forbidden";
    message: string;
    status: 403;
} | InputError | {
    error: "webhook_disabled";
    message: string;
};

export interface InputError {
    error: "invalid_input";
    message: string;
}

export interface ServerResponseWithInvalidOptions {
    /** Unvalidated JSON from the API, an SDK error, or null for an empty body. */
    data: unknown;
    invalidOptions: unknown[];
}

export interface CommandSummary {
    successes: number;
    failures: number;
    failureReasons: Array<{
        command: unknown;
        error: string;
    } | {
        command: string;
        status?: number;
        code?: unknown;
        apiResponse?: unknown;
    }>;
    results: Array<{ command: string; response: unknown }>;
}

export interface WebhookMethods {
    verify(input?: WebhookVerificationInput): boolean;
    erlcUrl(): string | null;
    /** Unvalidated relay JSON, an SDK error, or null for an empty body. */
    status(options?: { signal?: AbortSignal }): Promise<unknown>;
    /** One page of unvalidated Poll-mode relay JSON. */
    listEvents(options?: { signal?: AbortSignal }): Promise<unknown>;
    /** Poll-mode relay JSON, an SDK error, or null for an empty body. */
    events(options?: { signal?: AbortSignal }): Promise<unknown>;
    /** Acknowledge processed v2 Poll events. */
    acknowledge(eventIds: string[], options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface CustomCommandEvent {
    id: string;
    type: "CustomCommand";
    command: string;
    argument: string;
    args: string[];
    userId: string;
    serverId: string;
    username: string;
    timestamp?: unknown;
    receivedAt?: unknown;
    raw: Record<string, unknown>;
}

export type CommandActionResult = CommandSummary | InputError | {
    error: "player_not_found" | "command_unavailable";
    message: string;
};

export interface CommandContext {
    event: CustomCommandEvent;
    command: string;
    argument: string;
    args: string[];
    userId: string;
    serverId: string;
    reply(message: string): Promise<CommandActionResult>;
    announce(message: string): Promise<CommandActionResult>;
}

export interface CommandOptions {
    /** Per-player cooldown in milliseconds. */
    cooldown?: number;
}

export interface CommandStartOptions {
    /** Delay between completed Poll requests. Defaults to 2000ms; minimum 100ms. */
    pollInterval?: number;
    signal?: AbortSignal;
}

export interface CommandStopOptions {
    /** Maximum time to wait for an active handler. Defaults to 10000ms. */
    timeout?: number;
}

export type CommandHandleResult =
    | { status: "ignored"; reason: "unsupported_event" }
    | { status: "rejected"; reason: "invalid_signature" | "invalid_json" }
    | { status: "duplicate" | "unhandled"; eventId: string; command: string }
    | { status: "cooldown"; eventId: string; command: string; remaining: number }
    | { status: "handled"; eventId: string; command: string; value: unknown }
    | { status: "failed"; eventId: string; command: string; error: unknown };

export type CommandHandler = (context: CommandContext) => unknown | Promise<unknown>;

export class CommandRouter extends EventEmitter {
    constructor(options?: {
        pollEvents?: (options?: { signal?: AbortSignal }) => Promise<unknown>;
        acknowledgeEvents?: (eventIds: string[], options?: { signal?: AbortSignal }) => Promise<unknown>;
        sendCommands?: (commands: string[]) => Promise<CommandActionResult>;
        getServer?: (options: ServerOption[]) => Promise<unknown>;
        verifyWebhook?: (input?: WebhookVerificationInput) => boolean;
        maxSeenEvents?: number;
    });
    readonly running: boolean;
    command(name: string, handler: CommandHandler, options?: CommandOptions): this;
    remove(name: string): boolean;
    handle(event: unknown): Promise<CommandHandleResult>;
    handleWebhook(input: WebhookVerificationInput): Promise<CommandHandleResult>;
    start(options?: CommandStartOptions): Promise<this>;
    stop(options?: CommandStopOptions): Promise<void>;
}

export default class LibertyJS {
    constructor(options: LibertyJSOptions);
    getPrivateServerAPI(options: ServerOption[] | undefined, includeInvalid: true): Promise<ServerResponseWithInvalidOptions>;
    getPrivateServerAPI(options?: ServerOption[], includeInvalid?: false): Promise<unknown>;
    getPrivateServerAPI(options: ServerOption[] | undefined, includeInvalid: boolean): Promise<unknown>;
    sendPrivateServerCommand(commands?: string[]): Promise<CommandSummary | InputError>;
    verifyWebhook(input?: WebhookVerificationInput): boolean;
    webhook: WebhookMethods;
    commands: CommandRouter;
}

export const DEFAULT_WEBHOOK_RELAY_URL: string;
export const ERLC_WEBHOOK_PUBLIC_KEY: string;
