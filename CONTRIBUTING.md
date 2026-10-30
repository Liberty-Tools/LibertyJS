# Contributing to LibertyJS

Bug reports, documentation improvements, and code contributions are welcome. Open an issue before starting a larger change so we can agree on its scope.

## Set up the repository

Install Node.js and npm. The package declares Node.js 18 or later; use a currently maintained Node.js release for development.

```sh
git clone https://github.com/Liberty-Tools/LibertyJS.git
cd LibertyJS
npm ci
git switch -c your-change-name
```

Always work on a separate branch and open a pull request. Do not push changes directly to `main`.

The runtime uses JavaScript ES modules. Public TypeScript declarations are maintained separately in `src/index.d.ts`.

## Where to make changes

| File or folder | Purpose |
| --- | --- |
| `src/index.js` | API requests, rate limits, Poll methods, and signature verification. |
| `src/commands.js` | Command routing, cooldowns, replies, and the Poll loop. |
| `src/index.d.ts` | Public TypeScript declarations. |
| `test/` | Runtime tests and TypeScript consumer checks. |
| `examples/` | Runnable examples for SDK users. |
| `readme.md` | Installation, setup, and API guidance. |

## Check your work

```sh
npm run check
npm pack --dry-run
```

`check` runs runtime tests and strict TypeScript checks using NodeNext and Bundler resolution. Tests use mocked requests and need no live ERLC credentials. `pack --dry-run` lists the files that would ship to npm without publishing them.

Add regression tests for behavior changes. Update declarations, examples, and the README together when changing the public API. Never commit real server keys, Poll tokens, webhook credentials, or private player data.

## Open a pull request

Explain the problem, what changes for users, and which checks you ran. Keep unrelated changes separate. Add a changelog entry when behavior changes. Documentation examples must use placeholders and methods that exist in the current package.

Use a GitHub issue or the [support Discord](https://discord.gg/YFjuXJcnVC) for questions. Follow the [security policy](SECURITY.md) for vulnerabilities instead of opening a public issue.
