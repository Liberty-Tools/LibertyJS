import LibertyJS from "@libertytools/libertyjs";

const { SERVER_KEY, LIBERTYTOOLS_WEBHOOK_ID } = process.env;
if (!SERVER_KEY || !LIBERTYTOOLS_WEBHOOK_ID) {
    throw new Error("Set SERVER_KEY and LIBERTYTOOLS_WEBHOOK_ID before starting this example");
}

const erlc = new LibertyJS({ SERVER_KEY, WEBHOOK_ID: LIBERTYTOOLS_WEBHOOK_ID });

erlc.commands.command("help", async context => {
    const result = await context.reply(
        "Need help? Ask a staff member or join our support channel."
    );
    if ("error" in result) {
        console.error("Reply failed:", result.error);
    } else if (result.failures > 0) {
        console.error("ER:LC rejected the reply:", result.failureReasons);
    } else {
        console.log(`Replied to user ${context.userId}`);
    }
}, {
    cooldown: 10_000
});

erlc.commands.on("handled", ({ command, eventId }) => {
    console.log(`Handled ;${command} (${eventId})`);
});

erlc.commands.on("cooldown", ({ command, remaining }) => {
    console.log(`Skipped ;${command}: ${remaining}ms of cooldown remaining`);
});

erlc.commands.on("pollError", ({ error }) => {
    console.error("Poll failed:", error.message);
});

erlc.commands.on("commandError", ({ command, error }) => {
    console.error(`Handler for ;${command} failed:`, error);
});

async function shutdown() {
    console.log("Stopping LibertyJS command polling...");
    await erlc.commands.stop();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await erlc.commands.start();
console.log("Listening for ;help through Liberty Tools Poll mode");
