# Security policy

## Report a vulnerability privately

Email [admin@libertytools.dev](mailto:admin@libertytools.dev). This contact also accepts reports about the LibertyTools hosted service. Name the affected package or service so we can investigate the right component.

Do not post vulnerabilities, credentials, or private player data in public issues or Discord channels. If GitHub offers **Report a vulnerability** on this repository, you may use that private reporting flow instead.

Include:

- The affected version or service.
- What an attacker could do and what access they would need.
- Safe steps to reproduce the issue, preferably with a small example.
- Sanitized logs or screenshots, if useful.

Do not send real API keys, Poll tokens, passwords, or session tokens. Prefer a test environment and do not test against other users' servers.

## Supported versions

Security fixes target the latest stable SDK release. Older releases do not receive separate backports. Update with:

```sh
npm install @libertytools/libertyjs@latest
```

Check the [changelog](CHANGELOG.md) and repository security advisories for published fixes. This policy does not promise a response or resolution deadline.

## Use the SDK safely

- Run LibertyJS on a trusted Node.js server or computer, not in browser code.
- Keep server keys, global API keys, and Poll tokens out of source control and logs.
- Verify direct ERLC webhooks using the exact raw request bytes.
- Authenticate forwarded requests before passing events to `commands.handle()`. That method does not verify the sender.
- Check API and command results before treating an action as successful.

See the [README](readme.md) for setup and the [roadmap](ROADMAP.md) for known limitations.
