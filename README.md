# Indiecorns

Indiecorns is the CLI and agent plugin for Indiecorns onboarding. It helps
developers sign in, inspect available onboarding tasks, run agent-safe action
plans, and install the local Indiecorns plugin for Codex and compatible agent
environments.

## Install

Optional macOS idle and closed-lid power helpers have separate opt-in, status,
disable and uninstall paths. Plans and installer packages are inert. See
[power helper behavior and hardware limits](docs/macos-power.md).

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

## Automatic background-worker onboarding

Every community member can use the same command on their own computer:

```bash
npx --yes indiecorns@latest worker setup --mode execute --wait
```

Setup verifies the Indiecorns session and fresh community Slack feed, reuses an
existing GitHub CLI login, verifies its actor through a read-only GitHub request,
stores the validated credential privately for background startup, and registers
the OS service with a permanent runtime when launched through npx. No member
needs the Slack app token, workspace ID, channel ID or a hand-edited policy file.
New execute policies enable only fresh verified Slack-member GitHub follows and
stars, capped at **one external attempt per UTC day**. Omit `--mode execute` to
collect observations and local briefs without external actions.

Copy setup from https://app.indiecorns.com/join to bind it to your signed-in account. The `--account` handoff checks your Terminal authorization automatically. If it belongs to a different account, setup presents a sign-in link and continues after you authorize the same website account. A wrong browser account is rejected before replacing saved authorization. `--check` only reports mismatches; existing execute policies stay bound to their original account, with limits and history preserved. No config diagnostic commands are needed.

If community login is missing, setup streams a device sign-in URL without opening
a browser. After the member authorizes it, the waiting command automatically
continues through account verification and service setup. No second terminal
command is required. The default wait is 180 seconds (`--timeout` accepts 1–900).
Normal setup shows readable progress, the result and the next step. Use `--json`
for one structured result or `--wait --ndjson` for lifecycle events. Omit
`--wait` to return a resumable sign-in link instead of waiting. Pending
handoffs preserve their requested mode and are reused after timeout or restart.
If GitHub login is missing or under-scoped, the
discovery service can still run and setup shows the precise GitHub
authorization command. A stored token that expires can be replaced from an
already-refreshed GitHub CLI login only after verifying the same previously
proven numeric actor. Checks never save a replacement, account switches are
rejected and provider rate limits never trigger credential switching. Provider
consent cannot be granted by another member.
GitHub's scope headers are checked when available; providers enforce actual
resource permissions when an action is attempted. Authentication is not proof of
every permitted write.

Setup is resumable and serialized. Repeating it preserves existing policy,
queue, receipts, quotas and source selection, and does not reinstall a running
service. A registered but unhealthy service is diagnosed for recovery rather
than silently replaced. Existing execute policies bound to another account fail
closed. Setup cannot remotely install software on other members' computers.

```bash
indiecorns worker setup --check
indiecorns worker health --hours 24
```

`--check` performs read-only provider and OS checks and never stores credentials,
creates policy, starts login, installs or restarts a service. Setup and health
use readable text by default; add `--json` or `--agent` for structured output.
Setup exits nonzero when setup or authorization remains incomplete. A live process
with failing sources returns `running_with_source_requirements`. `ready` means
the configured worker and supported GitHub setup are ready; Product Hunt and other
platforms are reported separately and are not implicitly enabled. Slack roster
membership and mapped profiles are reported separately: missing identity links
are never guessed from names or email addresses. Machines must remain awake,
online and logged in. The initial sign-in and provider authorization still need
the member's own session.

## Continuous worker

Background workers require Node.js 22.22 LTS or Node.js 24+ with built-in SQLite.
Other CLI commands retain their existing Node.js support. Worker state must stay
on the computer's local disk.

```bash
indiecorns worker run --once
indiecorns worker run --interval-seconds 300
indiecorns worker status
indiecorns worker install
indiecorns worker service-status
indiecorns worker uninstall
```

The worker polls 13 explicit profile/post/project sources across Peerlist, X,
LinkedIn and Product Hunt using the authenticated community target endpoint. When
the backend supplies pagination metadata, each page and cursor are committed together.
Each cycle reads at most two pages per source; unfinished scans continue after five
seconds, skip completed sources, and resume after crashes or rate limits. A completed
scan restarts from the beginning on the normal polling interval. Older backends
still work, with full unpaginated pages reported as incomplete discovery. The worker
persists a local
queue in `~/.indiecorns/worker/state.json`, deduplicates targets across restarts,
and uses exponential backoff for failed requests. Each GET can retry a transient
transport failure once after one second; successful retries are counted in the
source report. HTTP rate limits and certificate failures never trigger that
immediate retry. Transport/DNS/connection,
timeout and HTTP 5xx failures have a five-minute recovery ceiling; explicit
provider Retry-After delays remain honored. A bounded 24-entry diagnostic history
records whitelisted failure kind, stage, source key, network code or HTTP status.
It never stores exception messages, URLs, response bodies or tokens. Failed polls
clear stale successful source rows; a healthy subsequent poll clears the active
error while retaining diagnostic history. SIGINT and SIGTERM release
the process guard. CLI version metadata does not change credential identity;
upgrades preserve matching discovery/feed cursors and provider cooldowns. The
worker handles SIGINT and SIGTERM by releasing
ownership cleanly. A dedicated SQLite exclusive transaction provides process
ownership; the OS releases it after a forced crash. The PID file is diagnostic,
so losing it or reusing a dead worker's PID cannot admit a second worker or block
recovery. The guard database is never deleted during startup or shutdown. One
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
health. The worker data directory has a default **128 MiB storage budget**, with
4 MiB reserved for bounded health/control files. Atomic writes count both the old
checkpoint and its temporary replacement. If another checkpoint or cold payload
would exceed the budget, the worker fails closed, records `storage.health` as
`capacity_reached`, and preserves the last committed queue, receipts and action
budget. A provider action cannot begin when its intent cannot be committed.
Supervision retries startup; it does not delete work or expand the limit.
Incomplete temporary writes are removed on failure. Budgeting covers worker data,
not the separate Node/npm installation or managed package runtime.

```bash
indiecorns worker storage
indiecorns worker storage --max-mib 256
```

An explicit disk budget between 16 and 512 MiB takes effect on subsequent writes,
including supervised recovery. Check available space before increasing it.
Changing storage limits never changes the daily action cap. Pending work and
external receipts are never evicted to make room. Storage capacity therefore
requires attention when retained data reaches its configured bound.
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

`indiecorns worker health --hours 24` reports local minute-by-minute process
samples, progress stalls, restart gaps and source health. This history starts
when the recorder is installed; it does not reconstruct earlier uptime. Expected
scheduled sleep is distinct from a stalled operation. `continuous_samples` means
the requested window has samples with no gap above 90 seconds; inspect unhealthy
samples, stops and progress stalls separately. It is not an uptime percentage or
proof that every scrape or action succeeded.

The recorder runs during network waits and backoff without making extra network
requests. Three rotating daily files, each capped at 1 MiB, bound its disk usage.
They contain timestamps, process/session identifiers, phase, source-health flags
and target counts; no URLs, message bodies or credentials. Corrupt, missing or
future-dated history is reported as unproven. Diagnostic storage failures do not
reset the queue or stop useful work.

### Action policy and evidence

The default `draft` policy creates a reusable local support brief for each
successfully observed target. Read them with `indiecorns worker briefs`.
Briefs contain source URLs, observed metadata and timestamps; they are not posted
or counted as engagement. `worker policy --mode collect` disables action work.

External adapters support GitHub stars, member follows and issue thumbs-up
reactions, plus Product Hunt profile follows, using separate provider credentials and exact repository/user/issue
allowlists. Execution policies bind to the current
community account and must be reconfigured after an account change:

```bash
indiecorns worker policy --mode execute --github-repository maker/project --max-external-per-day 5
indiecorns worker policy --mode execute --github-user maker --max-external-per-day 5
indiecorns worker policy --mode execute --github-issue 'maker/project#12' --max-external-per-day 5
indiecorns worker credentials --provider github --token-stdin < /secure/path/github-token
```

For unattended support as new members and repositories appear, opt in to a
verified Slack-member scope:

```bash
indiecorns worker policy --mode execute --github-member-actions follow,star --max-external-per-day 5
```

This permits follows of explicitly mapped, current Slack members and stars of
their observed public repositories. It requires fresh roster evidence and an
exact GitHub profile mapping; shared links, names, target flags and queue priority
cannot authorize it. The credential's numeric actor ID and username are read
before member-scoped work, and automatic actions on that account's own profile
or repositories are skipped. Membership is checked again immediately before a
write. Expired evidence, channel departure or a changed mapping withdraws the
scope. Existing policies enable no member-wide actions.

Member-scoped actions share the account binding, daily budget, provider cooldown
and permanent receipts with exact allowlists. Changing between scopes does not
replay completed actions. Issue reactions still require an exact issue allowlist.
Member-scoped intents and receipts retain the authorizing Slack identity,
membership timestamps, account binding and numeric GitHub actor ID.
Select one kind with `--github-member-actions follow` or `star`, and revoke the
scope with `--github-member-actions=` and `--mode execute`. Exact repository,
user and issue allowlists remain independent.

Exact allowlists act only on GitHub repository, profile or issue targets whose public
page was observed. Existing version-1 policies without `githubUsers` or
`githubIssues` permit no follows or reactions respectively. All action kinds share
one daily budget and provider cooldown, and
Slack-member priority determines their order. Repository links on known member
profiles are discovered automatically. A follow needs a classic token with
`user:follow`, or a fine-grained token with Followers read/write permissions.
Missing permissions are reported as `github_permission_required`.
Reactions require a public repository and exact issue ID, never a repository-wide
permission. The adapter checks the credential's numeric actor ID and reads
paginated reactions before and after adding `+1`; it rejects pull requests,
private repositories and incomplete proof. A maximum of ten 100-reaction pages
and a two-minute operation deadline bound each verification attempt. Fine-grained
tokens need Issues read/write permission. Clear a list with `--github-issue=`
(likewise `--github-user=` or `--github-repository=`). Policy changes are atomic.

Observed repository pages can seed their linked public issue indexes and numeric
issue posts, within the existing robots/host budgets and twenty-link page limits.
Issue listings refresh every fifteen minutes; existing post observations keep
their six-hour cooldown instead of being reset by rediscovery.
Slack priority for a member-owned repository's issue means `verified_slack_project`;
it does not claim that the member authored the post. Other platforms' post actions
still produce local briefs rather than an external reaction.

With a GitHub credential, the worker also searches for public issues updated
within the last thirty days by members' explicitly mapped GitHub accounts. It
verifies numeric provider IDs before assigning `verified_slack_author` priority,
so a member's post can be recognized outside a member-owned repository. Arbitrary
target author fields cannot grant that priority. Expiry, changed profile mappings
or channel departure withdraw it without deleting queued work.

Each completed author scan waits fifteen minutes. Two authors are processed per
cycle, search requests are spaced at least 2.1 seconds apart, and reserved polls,
pagination and cooldowns survive restarts. Incomplete results and GitHub's
1,000-result search ceiling stay explicitly partial. No post bodies, provider
profile emails or credentials are copied into the discovery cache. Discovery does
not enable reactions or change action quotas. Health history tracks this source
separately; older samples have no retroactive source-health claim.
It does not turn other links or page instructions into actions. The worker
persists intent and quota before writing, checks the remote state before and
after the idempotent request, and records unavailable proof as `unverified`.
Messages, comments, ratings, purchases and arbitrary shell commands have no
external executor. Credentials can also come from `INDIECORNS_GITHUB_TOKEN` or
`INDIECORNS_SLACK_TOKEN`. The stdin command stores credentials privately with
mode 0600 so supervised processes can read them; it never prints their values.
Remove a stored credential with `worker credentials --provider github --remove`.

Product Hunt follows use its [documented userFollow API](https://api-v2-docs.producthunt.com/mutation/userfollow/).
Its [provider requirements](https://www.producthunt.com/v2/docs) include approved
write access, `public private write` user scopes and permission for commercial
API use. A public/client-only token cannot execute this adapter.

```bash
indiecorns worker credentials --provider producthunt --token-stdin < /secure/path/approved-user-token
indiecorns worker policy --mode execute --producthunt-user maker --max-external-per-day 5
```

The exact allowlist accepts usernames without `@`; clear it with
`--producthunt-user=` and `--mode execute`. Existing policies enable no Product
Hunt actions. The observed target must be an exact `producthunt.com/@username`
profile. The adapter verifies viewer and target IDs, rejects self-follow and
GraphQL errors, reads the relationship before writing, and independently reads
it again after the mutation. A retry reconciles an existing follow without
another mutation. Intents, daily budget and completed receipts survive restart.
GitHub and Product Hunt share the daily cap and Slack-prioritized queue, while
provider cooldowns remain independent. Responses are bounded and each follow has
a 90-second deadline. No upvote, rating or comment executor is included.

With a configured credential, profile observations use the documented API's
public name, headline and identity fields instead of relying on HTML availability.
The API URL and username must match the queued profile. No email or media is
requested or stored. API observation rate limits are checkpointed and also pause
Product Hunt actions, without pausing GitHub. Profiles retain the worker's normal
six-hour observation interval.

`INDIECORNS_PRODUCTHUNT_TOKEN` is the optional environment credential; the stdin
command stores it privately for supervised services. Missing credentials or
permissions remain explicit failures. Product Hunt live authentication and a real
follow have not been verified in the Mac pilot.

Slack priority normally comes from the authenticated community feed. Members
without local Slack credentials need only their Indiecorns sign-in. The provider
token stays on the community server; the feed returns fresh membership proof and
public project/profile/post links. It excludes message bodies, media, invite links,
signed query URLs and Slack permalinks. It uses explicit owner mappings and never
guesses identity from a name. Provider limits, cursors and snapshot expiry persist
on the computer just like direct Slack discovery.

Existing local Slack configurations continue to work. Choose a source explicitly
with `indiecorns worker slack source community`, `local`, or `auto`. Auto uses a
configured local credential/snapshot pair when present, otherwise the community
feed. Choosing community preserves stored local credentials as a fallback option.

Direct Slack priority uses `~/.indiecorns/worker/slack-evidence.json`. It contains the
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

### Confirming a member worker

Setup sends a small verification after matching the registered OS process, worker
lock and a recent recorded heartbeat. The signed-in member can see that check at
https://app.indiecorns.com/join. New workers attach ongoing checks to their existing
community-feed reads. The website expires old evidence rather than counting a
login or copied command as an installation. It labels local setup checks and
scheduled background checks separately. This is authenticated local diagnostic
evidence, not remote OS access or hardware attestation. Paths, contacts, provider
credentials and queue content are never included. `setup --check` stays read-only
and does not refresh this website verification. Existing healthy services are
not upgraded or restarted merely to add ongoing check-ins.

GitHub CLI is required to reuse or authorize a member's own action credential;
missing installation now points to https://cli.github.com/ before the login command.
The public-profile OAuth step alone does not grant follow or star permissions.

### Member post discovery

The worker claims exclusive profile checks from Indiecorns, prioritizes its
member's own profile and shares observed X/LinkedIn posts with the Herd and other
workers. Reader-specific cooldowns let signed-in agents cover public-page access
gaps. Account-bound reports survive temporary outages and canonical URLs prevent
duplicate posts. No external data provider is used.

```sh
npx --yes indiecorns@latest worker discovery status
npx --yes indiecorns@latest worker discovery agent --json
```

The second command returns the bundled browser-reader module and runtime paths.
An active agent imports it in its trusted browser session and calls
`runBrowserDiscoveryOnce({browser,nodeExecutable,cliPath,appUrl})` with its
already-permitted browser. The reader checks visible post cards, matches the
actual author, excludes reposts/ambiguous quotes and closes temporary tabs. It
never launches another browser or copies cookies. Browser/host policy applies.

Other hosts can claim and report using `worker discovery claim --reader browser`
and `worker discovery report --stdin`. JSON reports contain
`{leaseToken,status,observedAt,posts:[{url,authorProfileUrl,title?}]}`. Use epoch-ms
timestamps and `observed`, `auth_required`, `blocked` or `unavailable` status.

For an existing unattended local reader:

```sh
indiecorns worker discovery reader --command /absolute/path/to/reader --args-json '[]'
```

The adapter receives `{version:1,platform,profileUrl,checkUrl}` on stdin and
returns the observation JSON on stdout, with a 90-second and 32-KB limit. The CLI
adds the lease token. This does not install a browser or grant a source session.

A running CLI alone cannot read authenticated LinkedIn activity. ChatGPT browser
checks run during active agent calls, not after the agent stops. `worker health`
and discovery status expose this requirement; they do not claim continuous
signed-in coverage. Source observations retain unverified ownership and cannot
authorize engagement or credits.

The CLI makes no paid model or data-provider calls. Five-minute idle polling adds
up to 288 coordination requests per worker/day plus reports. Active agents and
custom readers may have their own costs. Adaptive shared leases reduce actual
source reads across the community.

### Native scheduled browser checks

```sh
npx --yes indiecorns@latest worker discovery schedule --json
```

This returns a bounded handoff for an agent with the native Codex automation tool.
It prepares a schedule; it does not create one or modify scheduler files. The
agent must inspect existing schedules and create/reuse the matching member-post
schedule through the native tool. Worker audits and unrelated schedules stay
unchanged. The default is hourly, at most 24 runs and 48 source checks per day.
The phase is staggered by account to spread community work.

Each scheduled host turn supplies the active trusted browser context required by
ChatGPT. The agent calls `runScheduledDiscovery` from the bundled browser-agent
module with its permitted browser and the native automation ID. The function
checks at most one LinkedIn and one X task, honors server cooldowns and records
its small result through `worker discovery record-run --stdin`. Newer scheduled
observations appear in discovery status; idle checks do not refresh source times.
Account changes cannot reuse another account's reported results.

The computer must be awake/online, the host app must be running, and the permitted
browser must have the required session. This consumes the host subscription's
execution capacity; it does not make a paid model API call from the CLI. Native
schedules can be managed in the host app. Enabling a schedule or recording one
run is not proof of 24-hour coverage or other members' installations.
