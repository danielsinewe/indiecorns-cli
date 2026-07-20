---
name: indiecorns
description: Use Indiecorns from agent environments. Handles CLI auth, agent JSON discovery, onboarding tasks, dashboard handoff, and safe browser/login boundaries.
---

# Indiecorns Agent Workflow

Use this skill when the user asks to use Indiecorns from Codex, Cursor, Claude,
OpenClaw, or another coding agent.

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
npm run cli -- follow-members all --agent
npm run cli -- upvote peerlist --no-open
npm run cli -- upvote-members peerlist --agent
npm run cli -- rate peerlist --agent
npm run cli -- peerlist-launches --agent
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
npx indiecorns follow-members all --agent
npx indiecorns upvote peerlist --no-open
npx indiecorns upvote-members peerlist --agent
npx indiecorns rate peerlist --agent
npx indiecorns peerlist-launches --agent
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
`Authenticated.` in the terminal. A successful login also installs the local
`indiecorns` agent plugin into the user's plugin marketplace so Codex can load
the Indiecorns skill without a separate manual setup step. On remote machines or
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
- Use `npx indiecorns follow-members all --agent` to retrieve Indiecorns member
  follow targets for Peerlist, X, and Product Hunt. Follow the external profile
  in the signed-in browser before running the target's `recordCommand`.
- Use `npx indiecorns peerlist-launches --agent` for the Monday Peerlist launch
  queue. It returns project upvote and 5-star rating targets for Indiecorns
  launches, plus after-proof record commands. Only run those commands after the
  upvote and rating are visibly complete in a signed-in Peerlist browser.
- Treat social actions as external-platform actions. Agents may open the X,
  Product Hunt, and Peerlist URLs and click Follow, Upvote, or accept the company
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

## CLI Release and Publishing

When the user asks whether a CLI change is published, or says to publish,
release, ship, or "always do it", do not stop at local edits. Verify and push
the public npm release path.

Use the public package repository as the npm source of truth:

```bash
gh repo clone danielsinewe/indiecorns-cli /tmp/indiecorns-cli-release
```

The private app monorepo can be useful for development and local app testing,
but npm publishing should go through `danielsinewe/indiecorns-cli`. The private
monorepo's publish workflow may fail with npm registry permission errors even
when the public package workflow succeeds.

Preserve these contracts during release work:

- Keep `agent`, `--agent`, `--json`, and `wizard --ndjson --no-open`
  machine-readable. Do not add human prose, spinners, or banners to those
  outputs.
- Use `node --check indiecorns/bin/indiecorns.mjs`, `npm test`, and
  `npm pack --dry-run` in the public package repo before pushing a tag.
- Publish by committing the package changes, tagging `v<version>`, pushing
  `main`, then pushing the tag.
- Verify completion with `npm view indiecorns version dist-tags --json` and
  `npx -y indiecorns@latest help`.

If local `npm publish` fails with `E401` or `E404`, treat that as an auth or npm
permission boundary for the local token, then use the public GitHub Actions
workflow before reporting a blocker.
