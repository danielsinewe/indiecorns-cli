---
name: indiecorns
description: Use Indiecorns from agent environments. Handles CLI auth, agent JSON discovery, onboarding tasks, dashboard handoff, and safe browser/login boundaries.
---

# Indiecorns Agent Workflow

Use this skill when the user asks to use Indiecorns from Codex, Cursor, Claude,
OpenClaw, or another coding agent.

## Preferred CLI Entry Points

For continuous discovery and automated community support, use the worker path:

```bash
npx --yes indiecorns@latest worker setup --mode execute --wait --ndjson
npx --yes indiecorns@latest worker setup --check
npx --yes indiecorns@latest worker health --hours 24
```

The `worker` field in `agent` and Codex handoff JSON supplies structured command
arguments. This path needs no browser extension or local Slack app credential.
Setup streams a device authorization URL and continues in the same process after
the member authorizes their own account. Follow the host's permitted-browser
rules and keep the CLI process running while completing that handoff. A member's
provider authorization cannot be granted by another member. Waiting setup also
recovers from temporary community-service failures within its timeout, honoring
provider cooldowns. A service_unavailable result is not a request to sign in again. Missing GitHub login
or scopes remain explicit requirements; do not invent credentials or memberships.
Reused refreshed GitHub credentials must match the previously proven actor.

Verify setup's current process, heartbeat and source status. A running process
alone does not prove healthy discovery. Preserve existing policies, queues,
receipts, quotas and health history. Do not reinstall a healthy service merely
for proof or expand engagement scopes to force a test. A full-day claim needs
actual continuous healthy recorded coverage; never reset failed samples. Report
other members' installations and unsupported platforms as unverified until tested.

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
npm run cli -- indiehackers fill-profile --agent
npm run cli -- extension install --no-open
npm run cli -- extension review --no-open
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
npx indiecorns indiehackers fill-profile --agent
npx indiecorns extension install --no-open
npx indiecorns extension review --no-open
npx indiecorns join peerlist --no-open
npx indiecorns profiles --platform peerlist --json
npx indiecorns complete all
```

When Codex runs `npx --yes indiecorns@latest` with no arguments, the CLI detects
the host and returns a small `codex_handoff` object. Follow its `instruction` and
`nextAction`: ask for `requiredInput` when present, replace placeholders with the
real value, and require `evidenceRequired` before reporting completion.

`codex`, `agent`, and `--agent` are the stable machine-readable interfaces. Prefer them
over parsing human CLI output.

Use `wizard --ndjson --no-open` when an orchestrator wants setup progress as
newline-delimited JSON events before deciding whether to log in, install the
plugin, inspect tasks, or run onboarding actions.

## Authentication

Interactive first-time users should run:

```bash
npx --yes indiecorns@latest
```

The CLI opens the browser, reuses an existing Indiecorns web session when
available, waits for app auth to finish, then continues to the first unfinished
setup action in the same terminal command. A successful handoff also installs
the local `indiecorns` agent plugin into the user's plugin marketplace so Codex can load
the Indiecorns skill without a separate manual setup step. Use `login` only to
reconnect an existing installation. On remote machines or non-browser contexts,
use:

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
- Use `npx indiecorns extension install` to open the Chrome Web Store listing.
  The installed extension verifies this zero-credit onboarding action when the
  user signs in. `npx indiecorns extension review` is optional and must never be
  tied to credits or described as requiring a positive rating.
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
- Use `npx indiecorns indiehackers fill-profile --agent` to get the current
  Indie Hackers profile fill plan. Browser automation may prefill
  `https://www.indiehackers.com/danielsinewe/editing`, but the user must review
  and save the form manually.
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

## Local member-post discovery

The CLI coordinates public checks in the background. For signed-in reading during
an authorized agent session, run `indiecorns worker discovery agent --json`.
It returns `readerModule`, `nodeExecutable`, `cliPath` and `appUrl`. In the host's
trusted Node/browser session, import that exact module and call:

```js
await reader.runBrowserDiscoveryOnce({browser, nodeExecutable, cliPath, appUrl})
```

`browser` must be the host's already-selected permitted browser. Always follow
its browser-selection rules: ChatGPT cloud browser first when available, then
ChatGPT in-app browser; never silently select local Chrome. Keep work in the
background. The bundled reader claims one short lease, reads the exact assigned
activity page, matches each post card's author, excludes reposts and ambiguous
quoted posts, reports canonical links, and closes only tabs it created.

Use `worker discovery status --json` to inspect source requirements and pending
reports. `profile_required` means connect the member profile at /join, not repeat
account login. `auth_required` means that source needs its own signed-in session.

For other supported hosts, `worker discovery claim --reader browser --platform
linkedin` (or `x`) returns one task. Report through `worker discovery report
--stdin` with a small JSON object containing `leaseToken`, `observedAt` in epoch
ms, `status` (`observed`, `auth_required`, `blocked`, `unavailable`) and `posts`.
Each post needs `url`, `authorProfileUrl`, and optionally a short `title`. An empty
`observed` result needs an explicitly readable empty activity list; relative age
hints and “posted in the past 30 days” do not prove a post. Never export cookies,
credentials or whole pages. Reports persist privately until acknowledged, expired
or rejected; retries stay bound to the same account.

An existing trusted unattended reader can be configured with `worker discovery
reader --command /absolute/path/to/reader --args-json '[]'`. It receives one JSON
line on stdin (`platform`, `profileUrl`, `checkUrl`), returns one observation JSON
object, and gets 90 seconds and 32 KB. Remove with `worker discovery reader
--remove`. This is an optional host adapter, not a bundled browser subprocess.

ChatGPT's browser runtime requires an active agent call. Do not put its private
RPC in a background process, copy its session, promise it runs after the agent
stops, or claim 24-hour coverage from a single observed cycle. No external data
provider or model API is called by the CLI; active agents/readers may have their
own costs. Worker observations do not independently verify ownership or prove
engagement. Read-only discoveries must not authorize likes, reposts or comments.

## Native unattended member-post schedule

When the user requests recurring/continuous member-post discovery and this host
provides its native automation tool, run `worker discovery schedule --json` for
the current installed CLI's bounded handoff. Inspect existing native automations
first. Reuse a matching member-post schedule, preserving its fields; do not
repurpose worker audits, create duplicate schedules, edit automation files or
invent a private scheduler API. Use the native tool to create/update the schedule
under the user's authorized scope and keep its returned automation ID.

The default is hourly with an account-staggered phase and at most two source
checks per run. Make host-subscription usage and awake/online/app/session
requirements explicit. In the native scheduled turn, import the returned reader
module in the trusted browser session and call
`runScheduledDiscovery({browser,nodeExecutable,cliPath,appUrl,automationId})`.
Use the native automation's actual ID. The helper claims one task per platform,
performs permitted reads and records its account-bound result. A null task is
normal. Do not self-trigger or use this schedule to track CI, deployments, goal
progress or unrelated work. Source sign-in/blocks are requirements, not permission
to switch browsers or manufacture success. Preserve existing user tabs.

Require actual scheduler dispatch and matching source/report evidence before
claiming an unattended run. A configured schedule, a manually invoked helper, or
a client checkpoint alone is insufficient. Do not infer 24-hour coverage or all
members' readiness from a single run. This path works through a new active host
turn each time; it never keeps private browser RPC alive outside an active turn.
