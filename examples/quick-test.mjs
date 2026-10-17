import LibertyJS from "@libertytools/libertyjs";

// PowerShell setup:
//   $env:SERVER_KEY="your ER:LC server key"
//   $env:LIBERTYTOOLS_WEBHOOK_ID="your Liberty Tools Poll webhook ID"
//   npm run example:commands

const { SERVER_KEY, LIBERTYTOOLS_WEBHOOK_ID } = process.env;

if (!SERVER_KEY || !LIBERTYTOOLS_WEBHOOK_ID) {
    console.error("Missing SERVER_KEY or LIBERTYTOOLS_WEBHOOK_ID.");
    console.error("Set both environment variables using the commands at the top of this file.");
    process.exitCode = 1;
} else {
    const erlc = new LibertyJS({
        SERVER_KEY,
        WEBHOOK_ID: LIBERTYTOOLS_WEBHOOK_ID
    });

    erlc.commands.command("libertytest", async context => {
        console.log(`Received ;libertytest from user ${context.userId}.`);

        const result = await context.reply(
            "LibertyJS command routing is working!"
        );

        if ("error" in result) {
            console.error(`Could not send the PM: ${result.error}`);
            return;
        }

        if (result.failures > 0) {
            console.error("ER:LC rejected the PM:", result.failureReasons);
            return;
        }

        console.log("Success: ER:LC accepted the PM command.");
    }, {
        cooldown: 5_000
    });

    erlc.commands.on("pollError", ({ error }) => {
        console.error("Poll request failed:", error.message);
    });

    erlc.commands.on("commandError", ({ error }) => {
        console.error("Command handler failed:", error);
    });

    let stopping = false;
    async function stop() {
        if (stopping) return;
        stopping = true;
        console.log("Stopping the quick test...");
        await erlc.commands.stop();
    }

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);

    await erlc.commands.start();
    console.log("Quick test is running.");
    console.log("Join the configured ER:LC server and run ;libertytest");
    console.log("Press Ctrl+C when finished.");
}
