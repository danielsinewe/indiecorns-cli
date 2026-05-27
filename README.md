# Indiecorns

[![npm version](https://img.shields.io/npm/v/indiecorns.svg)](https://www.npmjs.com/package/indiecorns)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/danielsinewe/indiecorns-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/danielsinewe/indiecorns-cli/actions/workflows/ci.yml)

Indiecorns is the CLI and agent plugin for Indiecorns onboarding. It helps
developers sign in, inspect available onboarding tasks, run agent-safe action
plans, and install the local Indiecorns plugin for Codex and compatible agent
environments.

## Install

Run the CLI directly with npm:

```bash
npx indiecorns
```

Or install it globally:

```bash
npm install --global indiecorns
indiecorns help
```

The package requires Node.js 20.20 or newer, or Node.js 22.22 or newer.

## Common Commands

```bash
npx indiecorns login
npx indiecorns signup
npx indiecorns status
npx indiecorns tasks
npx indiecorns run
npx indiecorns dashboard
npx indiecorns doctor
```

`npx indiecorns login` opens the browser, waits for the Indiecorns app to finish
Google sign-in, and confirms the local CLI session in the terminal. On a remote
machine or in automation, pass `--no-open` to print the login URL without
launching a browser.

## Agent Workflows

Use the structured JSON interfaces when another agent is orchestrating the CLI:

```bash
npx indiecorns agent
npx indiecorns tasks --agent
npx indiecorns run --agent
```

`agent` and `--agent` are stable machine-readable surfaces. They avoid browser
opens and return the auth, dashboard, action, and next-command data an agent
needs without parsing human terminal output.

For JSON output without the full agent plan:

```bash
npx indiecorns status --json
npx indiecorns tasks --json
npx indiecorns profiles --platform peerlist --json
```

## Onboarding Actions

The CLI can open or record the current Indiecorns onboarding actions:

```bash
npx indiecorns follow x
npx indiecorns follow linkedin
npx indiecorns follow peerlist
npx indiecorns upvote peerlist
npx indiecorns rate peerlist
npx indiecorns join peerlist
npx indiecorns join discord
npx indiecorns complete all
```

Social actions are external-platform actions. The CLI can open the destination
and record progress in Indiecorns, but agents should only mark an action as
complete after the action was actually performed in the user's signed-in browser
session.

## External Profiles

Save profile links used by Indiecorns and agent follow workflows:

```bash
npx indiecorns profile set peerlist --username yourname
npx indiecorns profile set x --username yourname
npx indiecorns profile set linkedin --username yourname
npx indiecorns profile set github --username yourname
npx indiecorns profile set substack --username yourname
npx indiecorns profile set website --profile-url https://example.com
npx indiecorns profile show
```

## Codex Plugin

Install the Indiecorns Codex plugin from the public package:

```bash
npx indiecorns plugin install
```

This writes the plugin to `~/plugins/indiecorns` and registers it in
`~/.agents/plugins/marketplace.json`. Restart Codex after installing so it
reloads the local plugin marketplace.

## Telemetry

The CLI sends product telemetry to Indiecorns so onboarding and agent handoffs
can be improved. It identifies the signed-in Indiecorns user when a valid CLI
session is available and avoids sending secrets.

```bash
npx indiecorns telemetry status
npx indiecorns telemetry disable
npx indiecorns telemetry enable
```

You can also disable telemetry for a single run:

```bash
npx indiecorns tasks --no-telemetry
```

## Local Development

From this repository root:

```bash
npm install
npm run cli -- help
npm run smoke
npm run pack:check
```

This repository is the public CLI and agent plugin source. The hosted
Indiecorns app and private operational code are maintained separately.

Run the complete local check before publishing:

```bash
npm test
```

## Package Contents

The npm package intentionally ships only the CLI entrypoint and agent plugin
assets. The Next.js app source, generated build output, local auth state, and
environment files are excluded from the public tarball.

## Support

- Website: https://indiecorns.com
- App: https://app.indiecorns.com
- Source: https://github.com/danielsinewe/indiecorns-cli
- Issues: https://github.com/danielsinewe/indiecorns-cli/issues

## License

MIT.
