import LibertyJS from "@libertytools/libertyjs";

// PowerShell setup:
//   $env:ERLC_SERVER_KEY="your ER:LC server key"
//   $env:POLL_SUBSCRIPTION_ID="your dashboard Poll subscription ID"
//   $env:POLL_TOKEN="your dashboard Poll token"
//   npm run example:commands

const { ERLC_SERVER_KEY, POLL_SUBSCRIPTION_ID, POLL_TOKEN } = process.env;

if (!ERLC_SERVER_KEY || !POLL_SUBSCRIPTION_ID || !POLL_TOKEN) {
    console.error("Missing ERLC_SERVER_KEY, POLL_SUBSCRIPTION_ID, or POLL_TOKEN.");
    console.error("Create a Poll client in Dashboard → Outputs, then set the three environment variables above.");
    process.exitCode = 1;
} else {
    const erlc = new LibertyJS({
        SERVER_KEY: ERLC_SERVER_KEY,
        POLL_SUBSCRIPTION_ID,
        POLL_TOKEN
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
