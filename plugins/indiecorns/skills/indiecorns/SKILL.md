---
name: indiecorns
description: Use Indiecorns as a product user from agent environments. Handles CLI login, agent JSON discovery, onboarding tasks, dashboard handoff, profile follow/upvote/join actions, and safe browser boundaries. Public user-facing skill.
---

# Indiecorns User Workflow

Use this skill when a user wants an agent to operate Indiecorns for their own
account: sign in, inspect onboarding tasks, open the dashboard, follow profiles,
upvote or join launches, and record completion.

## Preferred CLI Entry Points

Run the local checkout CLI when the current workspace is the Indiecorns repo:

```bash
npm run cli -- agent
npm run cli -- wizard --ndjson --no-open
npm run cli -- login
npm run cli -- tasks --agent
npm run cli -- run --agent
npm run cli -- follow x --no-open
npm run cli -- follow linkedin --no-open
npm run cli -- follow peerlist --no-open
npm run cli -- upvote peerlist --no-open
npm run cli -- join peerlist --no-open
npm run cli -- profiles --platform peerlist --json
npm run cli -- complete all
```

Outside the repo, use the npm package:

```bash
npx indiecorns agent
npx indiecorns wizard --ndjson --no-open
npx indiecorns login
npx indiecorns tasks --agent
npx indiecorns run --agent
npx indiecorns follow x --no-open
npx indiecorns follow linkedin --no-open
npx indiecorns follow peerlist --no-open
npx indiecorns upvote peerlist --no-open
npx indiecorns join peerlist --no-open
npx indiecorns profiles --platform peerlist --json
npx indiecorns complete all
```

`agent` and `--agent` are the stable machine-readable interfaces. Prefer them
over parsing human CLI output.

Use `wizard --ndjson --no-open` when an orchestrator wants setup progress as
newline-delimited JSON events before deciding whether to log in, install the
plugin, inspect tasks, or run onboarding actions.

## Authentication

Interactive users should run:

```bash
npx indiecorns login
```

The CLI should open the browser, wait for app auth to finish, then report
`Authenticated.` in the terminal. A successful login also installs the public
`indiecorns` agent plugin into the user's plugin marketplace and the public
`indiecorns` skill into `~/.agents/skills/indiecorns`, so Codex-compatible
agents can load it without a separate manual setup step. On remote machines or
non-browser contexts, use:

```bash
npx indiecorns login --no-open
```

For CI or fully non-interactive environments, use `INDIECORNS_TOKEN` when the
platform provides a token.

## Agent Safety

- Treat CLI authentication as the required first step. Other onboarding tasks
  are locked until `npx indiecorns login` completes, because autopilot workflows
  need the CLI session and local plugin installed first.
- Never submit credentials, email addresses, or OAuth forms unless the user
  explicitly asks and the boundary is safe.
- Use `--no-open`, `--json`, or `--agent` when running inside automation.
- Do not scrape the Indiecorns dashboard when `npx indiecorns agent` provides
  the same action plan.
- Prefer `npx indiecorns run --agent` to execute every pending Indiecorns
  onboarding action in one command.
- Use `npx indiecorns profiles --platform peerlist --json` before Peerlist
  follow work. The CLI/app will return the signed-in user's known Peerlist
  username and any Indiecorns user profiles that should be followed.
- Treat social actions as external-platform actions. Agents may open the X,
  LinkedIn, and Peerlist URLs and click Follow, Upvote, or accept the company
  invitation when the user is already signed in, then record proof with
  `npx indiecorns record peerlist --target <username>` or run the completion
  command after the external action was actually performed.

## Expected Agent Plan Shape

`npx indiecorns agent` returns:

- `auth`: login/signup URLs and commands.
- `dashboard`: dashboard URL and safe command.
- `actions`: onboarding actions with `kind`, `url`, `credits`, and command.
- `nextCommands`: suggested terminal commands.

Use those fields directly when orchestrating Codex, Cursor, Claude, OpenClaw,
or other agent workflows.
