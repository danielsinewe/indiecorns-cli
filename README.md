# Indiecorns

Indiecorns is the CLI and agent plugin for Indiecorns onboarding. It helps
developers sign in, inspect available onboarding tasks, run agent-safe action
plans, and install the local Indiecorns plugin for Codex and compatible agent
environments.

## Install

Run the CLI directly with npm:

```bash
npx --yes indiecorns@latest
```

The default command opens secure browser sign-in when needed, waits for the
handoff, installs the agent plugin, and continues to the next setup action.
There is no separate login command during first-run setup.

Or install it globally:

```bash
npm install --global indiecorns
indiecorns help
```

The package requires Node.js 20.20 or newer, or Node.js 22.22 or newer.

## Common Commands

```bash
npx indiecorns wizard
npx indiecorns login
npx indiecorns signup
npx indiecorns status
npx indiecorns tasks
npx indiecorns run
npx indiecorns dashboard
npx indiecorns doctor
```

The wizard follows the best setup-CLI pattern: one terminal session, clear
progress, browser auth only when needed, and structured output for agents.

`npx indiecorns login` reconnects an existing CLI installation. It opens the
browser, waits for the Indiecorns app to finish sign-in, and confirms the local
CLI session in the terminal. The app
uses a short-lived device code and returns a single-use 30-day access token;
the CLI stores it in `~/.indiecorns/config.json` with user-only permissions and
never prints it. On a remote machine or in automation, pass `--no-open` to
print the login URL without launching a browser.

## Agent Workflows

Use the structured JSON interfaces when another agent is orchestrating the CLI:

```bash
npx indiecorns agent
npx indiecorns wizard --ndjson --no-open
npx indiecorns tasks --agent
npx indiecorns run --agent
```

`agent` and `--agent` are stable machine-readable surfaces. They avoid browser
opens and return the auth, dashboard, action, and next-command data an agent
needs without parsing human terminal output.

`wizard --ndjson` streams lifecycle events as newline-delimited JSON so Codex,
Claude, Cursor, CI jobs, or a custom orchestrator can render progress and act on
the next command without scraping the terminal UI.

For JSON output without the full agent plan:

```bash
npx indiecorns status --json
npx indiecorns tasks --json
npx indiecorns profiles --platform peerlist --json
npx indiecorns follow-members all --agent
```

## Onboarding Actions

The CLI can open or record the current Indiecorns onboarding actions:

```bash
npx indiecorns follow x
npx indiecorns follow linkedin
npx indiecorns follow peerlist
npx indiecorns upvote peerlist
npx indiecorns rate peerlist
npx indiecorns peerlist-launches --agent
npx indiecorns join peerlist
npx indiecorns join slack
npx indiecorns extension install
npx indiecorns extension review
npx indiecorns follow-members peerlist
npx indiecorns follow-members x
npx indiecorns follow-members producthunt
npx indiecorns complete all
```

Social actions are external-platform actions. The CLI can open the destination
and record progress in Indiecorns, but agents should only mark an action as
complete after the action was actually performed in the user's signed-in browser
session.

The Chrome extension is the fourth quick-start action. Installation is worth
zero credits and is verified only after the user opens the installed extension
and signs in. Reviews are optional and should always reflect the user's honest
experience.

`follow-members` uses Indiecorns profile data to list or open member profiles on
Peerlist, X, and Product Hunt. Use `--agent` or `--json` to get structured
targets and matching `record` commands without opening browser tabs.

`peerlist-launches` is the Monday community-support queue for Peerlist project
launches. It returns upvote and 5-star rating record commands, but those
commands should only run after the launch actions are visibly completed in a
signed-in browser.

## External Profiles

Save profile links used by Indiecorns and agent follow workflows:

```bash
npx indiecorns profile set peerlist --username yourname
npx indiecorns profile set x --username yourname
npx indiecorns profile set linkedin --username yourname
npx indiecorns profile set github --username yourname
npx indiecorns profile set indiehackers --username yourname
npx indiecorns profile set substack --username yourname
npx indiecorns profile set website --profile-url https://your-site.com
npx indiecorns indiehackers fill-profile --agent
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
npm run cli -- doctor
```

The Next.js app lives in the nested `indiecorns/` workspace:

```bash
npm --prefix indiecorns install
npm --prefix indiecorns run dev
npm --prefix indiecorns run typecheck
npm --prefix indiecorns run build
```

Run the package check before publishing:

```bash
npm pack --dry-run
```

## Package Contents

The npm package intentionally ships only the CLI entrypoint and agent plugin
assets. The Next.js app source, generated build output, local auth state, and
environment files are excluded from the public tarball.

## Support

- Website: https://indiecorns.com
- App: https://indiecorns.lovable.app
- Source: https://github.com/danielsinewe/indiecorns-cli
- Issues: https://github.com/danielsinewe/indiecorns-cli/issues

## License

MIT.
