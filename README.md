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

In a terminal, the default command opens secure browser sign-in when needed,
installs the agent plugin, and continues to the next setup action. In Codex, the
same command automatically returns a concise structured handoff with exactly one
next action, any required user input, and the proof needed to count it complete.
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
npx indiecorns codex
npx indiecorns wizard --ndjson --no-open
npx indiecorns tasks --agent
npx indiecorns run --agent
```

`codex`, `agent`, and `--agent` are stable machine-readable surfaces. They avoid browser
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

## Continuous worker (development preview)

```bash
indiecorns worker run --once
indiecorns worker run --interval-seconds 300
indiecorns worker status
indiecorns worker install
indiecorns worker service-status
indiecorns worker uninstall
```

The worker polls 13 explicit profile/post/project sources across Peerlist, X,
LinkedIn and Product Hunt using the authenticated community target endpoint. It
persists a local
queue in `~/.indiecorns/worker/state.json`, deduplicates targets across restarts,
and uses exponential backoff for failed requests. SIGINT and SIGTERM release
ownership cleanly; a restarted process can reclaim a dead worker's lock. One
worker can run per local account. Requests time out after 30 seconds.

Targets carrying explicit `slackMember: true` evidence are queued first.
The worker does not infer Slack membership from community registration.
Public pages are scraped with a transparent bot user agent. The scraper checks
robots.txt first, honors crawl delays and host cooldowns across restarts, limits
response sizes, and connects only to validated public IPv4 addresses over HTTPS.
It neither executes page scripts nor follows redirects implicitly. A site that
requires browser rendering, login, or a redirect remains explicitly unresolved.
Observations refresh every six hours independently of API discovery. Links to
posts and projects under the same member path enter the queue with unverified
link attribution; a link alone is not proof of authorship. The worker keeps up to
2,000 job payloads loaded between cycles and stores overflow in a private disk-backed
backlog. Due jobs return automatically, retaining their observation cooldowns and
deduplication keys across restarts. `worker status` includes the backlog index;
cycle output reports total pending, loaded and backlog counts. A daily retention
sweep retires successfully observed targets not rediscovered for 30 days and removes
their old local briefs. Unobserved work, unfinished external actions, completed
external-action receipts and daily quotas are preserved. Unreferenced backlog files
are removed only after committing state. Expired robots caches are reclaimed once
host cooldowns have elapsed. `worker status` includes retention counts and cleanup
health. Pending work and external receipts still consume disk as the community grows.
Additional engagement adapters are still pending: a successful
scrape never counts as a follow, vote, rating, comment, or completed support action.

`worker install` registers a macOS launchd agent, a Linux systemd user service,
or a Windows scheduled task with automatic recovery. These services start on user login; the computer must be
awake and online to work. Linux operation after logout needs user lingering
configured on the host. Windows tasks run for the logged-in user with no time
limit, a hidden parent that restarts a failed worker after 30 seconds, a one-minute
parent failure restart, and a five-minute recurring recovery trigger.
A hidden PowerShell launcher keeps the worker in the background. Services discard
stdout/stderr to prevent unbounded logs; inspect `worker status` for persisted
health. An install started through `npx` prepares a private permanent runtime in
`~/.indiecorns/runtime`, verifies the installed release against the invoking CLI,
and registers that stable path. Removing npm's execution cache then leaves the
service operational. Existing global installations and checkouts are reused.
Successful managed updates retain the active release and one rollback release.
Service registration records the actual CLI/Node paths so uninstall can stop a
managed worker even when invoked from a different temporary cache. Reinstall
after moving a reused global checkout or the Node executable.
No API key or paid model is required for polling. Sign in using `indiecorns login`
first; missing or expired authentication is recorded as `auth_required`.

### Action policy and evidence

The default `draft` policy creates a reusable local support brief for each
successfully observed target. Read them with `indiecorns worker briefs`.
Briefs contain source URLs, observed metadata and timestamps; they are not posted
or counted as engagement. `worker policy --mode collect` disables action work.

The first external adapter supports GitHub stars, using a configured credential
and an exact repository allowlist. Execution policies bind to the current
community account and must be reconfigured after an account change:

```bash
indiecorns worker policy --mode execute --github-repository maker/project --max-external-per-day 5
indiecorns worker credentials --provider github --token-stdin < /secure/path/github-token
```

This only acts on allowlisted GitHub repository targets whose public page was
observed. Repository links on known member profiles are discovered automatically.
It does not turn other links or page instructions into actions. The worker
persists intent and quota before writing, checks the remote state before and
after the idempotent request, and records unavailable proof as `unverified`.
Messages, comments, ratings, purchases and arbitrary shell commands have no
external executor. Credentials can also come from `INDIECORNS_GITHUB_TOKEN` or
`INDIECORNS_SLACK_TOKEN`. The stdin command stores credentials privately with
mode 0600 so supervised processes can read them; it never prints their values.
Remove a stored credential with `worker credentials --provider github --remove`.

Slack priority uses `~/.indiecorns/worker/slack-evidence.json`. It contains the
workspace/channel IDs, a complete roster with observation/expiry timestamps,
and explicit links between Slack IDs and public profile URLs. Membership lasts
at most 24 hours. Expired or removed membership withdraws priority; matching
names alone never establish identity. With a configured Slack credential, the
worker verifies the workspace with `auth.test`, follows all
`conversations.members` pages, excludes bots/deleted users with `users.info`,
and refreshes membership hourly. Identity mappings
must be established from member-provided links; the worker does not guess them.

Configure a public Slack channel after supplying its read-only credential:

```bash
indiecorns worker credentials --provider slack --token-stdin < /secure/path/slack-token
indiecorns worker slack configure --workspace T012ABC --channel C012DEF
indiecorns worker slack status
```

The app needs `channels:read`, `channels:history` and `users:read`, and must be
added to that channel. The worker reads new channel messages every five minutes
and resumes history pagination through a saved opaque cursor. It extracts public
links from channel messages and app notifications, including rich-text blocks,
and stores provenance rather than message bodies. Media/file bodies are rejected
before download. Verified
member-owned targets come first, then links shared by members, then other
community targets. A shared link does not establish external project ownership.
API rate limits and pending pages retain their deadlines across restarts.

The current Mac pilot has verified live API roster refresh and automatic
channel-link discovery. The Mac pilot has completed one independently verified GitHub star through an
exact one-repository allowlist and a one-action daily cap. The persisted receipt
survived restart without replay; broader platform executors remain pending.
