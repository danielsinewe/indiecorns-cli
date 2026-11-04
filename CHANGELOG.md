## 0.4.15 - 2026-11-04

- Confirm worker setup on the signed-in member's join page with bounded process/lock/heartbeat evidence; attach scheduled checks to existing feed reads without changing credential bindings.
- Report the actual running service version, preserve older healthy services, and keep read-only setup checks free of verification updates.
- Identify a missing GitHub CLI as an installation prerequisite and provide the install link before the authorization command.
- Collect no contacts, hostnames, file paths, provider tokens or queue content in installation evidence.

## 0.4.14 - 2026-11-04

- Make normal worker setup and health readable: named progress checks, clear outcomes, actionable recovery steps and npx commands that work without a global install.
- Explain background operation and preserved action limits; distinguish healthy current samples from healthy recorded coverage.
- Keep explicit --json, --agent and --ndjson machine-readable. Scripts consuming the former default JSON should add --json.
- Preserve setup authorization, provider consent, policies, live services, queues, receipts and health history.

## 0.4.13 - 2026-11-04

- Fix the copied onboarding command: `worker setup --wait` now waits for sign-in and continues setup without requiring `--ndjson`.
- Show readable authorization and retry instructions on stderr while preserving a single JSON result on stdout. Explicit `--ndjson` retains its structured event stream.
- Cover plain terminal, JSON and NDJSON waiting handoffs with actual spawned CLI tests. Existing worker processes, policy, receipts and health history are preserved.

## 0.4.12

- Waiting worker setup automatically retries temporary community-service failures within its timeout and honors provider cooldowns. Service outages no longer tell members to sign in again.
- Preserve exact sanitized authentication HTTP status and discovery source; community feed failures retain safe diagnostics.
- Existing live queue, policy, credentials, receipts and daily quotas remain unchanged.

# Changelog

## 0.4.11 - 2026-11-03

- Diagnose discovery failures with bounded, sanitized error metadata and retry
  transient transport/timeouts/5xx failures within five minutes while preserving
  provider cooldowns, queued progress, receipts and health history.
- Recover a transient GET failure with one bounded retry and report the retry;
  do not immediately retry rate limits or certificate failures.
- Keep credential identity stable across version metadata changes and migrate
  matching legacy bindings without clearing cursors or provider cooldowns.
- Add `worker setup --wait --ndjson` to continue automatically after device
  authorization and preserve requested setup mode across resumptions.
- Reuse an already-refreshed GitHub CLI token only for the same proven actor;
  reject account switches and never bypass provider throttling. Report failing
  sources as incomplete setup even when the service process is alive.
- Expose structured worker commands in agent/Codex handoffs and update the bundled
  skill so worker onboarding needs no extension setup.
- Update posthog-node to 5.61.2; no new dependencies.

## 0.4.10 - 2026-11-02

- Bound worker data writes to 128 MiB by default, counting atomic replacement
  peaks and reserving room for health/control records. Capacity failures preserve
  pending work, receipts and action quotas; no remote action can start without a
  committed intent. Failed atomic writes clean up their temporary files.
- Add `worker storage` diagnostics and an explicit 16–512 MiB disk budget setting,
  independent of action policy and honored during supervised recovery.

## 0.4.9 - 2026-11-02

- Add resumable `worker setup --mode execute` for shared Slack-feed onboarding,
  verified GitHub CLI credential reuse, private background credentials, a one-action
  daily member policy and automatic supervised startup. Existing services, source
  choices, policies, quotas and receipts remain unchanged on repeated setup.
- Add read-only `worker setup --check` with actual process/heartbeat matching,
  explicit account/permission failures and separate platform capability reporting.
- Preserve custom community app URLs in generated background-service commands.

## 0.4.8 - 2026-11-01

- Add opt-in Product Hunt profile follows through the documented API, using a
  separate private credential and exact user allowlist. Existing policies enable none.
- Verify viewer/target identity and before/after relationship state, preserve
  receipts across restarts, and reject self-follow or partial GraphQL proof.
- Observe Product Hunt profiles through the official API when configured, storing
  only bounded public metadata and sharing persisted provider cooldowns with actions.
- Share the daily action cap across providers while keeping provider cooldowns
  independent. Provider-approved write access is required for live execution.

## 0.4.7 - 2026-11-01

- Add opt-in GitHub stars and follows for freshly verified Slack members, so
  unattended support can include new members and repositories without individual
  allowlist edits. Existing policies retain their exact scopes.
- Exclude self-actions, require account binding and a verified GitHub actor, and
  recheck membership before writing. Reuse daily quotas, cooldowns and receipts
  across exact and member scopes. Issue reactions remain individually allowlisted.

## 0.4.6 - 2026-11-01

- Discover recent public issue posts authored by explicitly mapped Slack members,
  including posts outside member-owned repositories. Verify numeric author IDs
  and withdraw priority when membership or evidence expires.
- Persist author scan pagination, reserved polls and provider cooldowns; surface
  incomplete or capacity-limited searches without claiming full coverage.
- Record optional GitHub-post source health without invalidating earlier history.

## 0.4.5 - 2026-11-01

- Discover linked public GitHub issue indexes and issue posts from observed
  repositories, preserving the distinction between project ownership and authorship.
- Add opt-in issue thumbs-up reactions under exact issue allowlists, shared daily
  quotas, actor-bound remote proof and idempotent crash reconciliation.
- Allow explicit empty-list revocation and write policy changes atomically.

## 0.4.4 - 2026-11-01

- Record bounded local minute-by-minute worker health during network waits and
  scheduled backoff, without extra network requests or work-queue checkpoints.
- Add `worker health --hours 24` to distinguish short history, gaps, stale samples,
  expected sleep, progress stalls and unhealthy source samples. Missing or corrupt
  evidence cannot establish a full-day run.

## 0.4.3 - 2026-11-01

- Add opt-in GitHub member follows with an exact user allowlist and verified
  before/after API receipts. Follows and stars share one daily action budget,
  provider cooldown and Slack-prioritized scheduling.
- Preserve completed follow receipts across restarts and report missing provider
  permissions without claiming success. Existing policies permit no follows.

## 0.4.2 - 2026-11-01

- Apply fresh Slack membership to archived jobs before selecting observations,
  including newly mapped owners, expired rosters and member-shared links.
- Upgrade existing backlog indexes without loading all archived payloads at once.

## 0.4.1 - 2026-11-01

- Accept npm 12.2's package-keyed JSON report in permanent-runtime installation
  verification, while retaining compatibility with older npm versions.
- Publish the continuous worker described below; the 0.4.0 publishing gate stopped
  before uploading the package.

## 0.4.0 - 2026-11-01

- Add supervised community workers for macOS, Linux and Windows, with durable
  scheduling, discovery pagination, response limits, robots rules and crash recovery.
- Use kernel-backed worker ownership through built-in SQLite; background workers
  require Node.js 22.22 LTS or Node.js 24+. Other CLI commands retain Node.js 20 support.
- Prioritize verified Slack members and channel-shared projects through the
  authenticated community feed, without requiring personal Slack API credentials.
- Persist overflow jobs to disk, retire inactive observations, and keep external
  action receipts so rediscovery and restarts cannot reset deduplication.
- Generate local support briefs by default; allow opt-in GitHub stars under
  account-bound repository allowlists, daily quotas and verified remote receipts.
- Install permanent verified runtimes when registering a service from temporary
  npm execution caches. Preserve machine-readable agent and onboarding interfaces.

## 0.3.40 - 2026-08-25

- Detect Codex for the no-argument command and return one concise structured
  handoff with setup progress, the next action, required input, and proof.
- Stop treating the caller's local `indiecorns/` source tree as a CLI runtime
  dependency, removing irrelevant `node_modules`, layout, and dev-script warnings.
- Preserve explicit `wizard`, `agent`, JSON, and NDJSON interfaces.

## 0.3.39 - 2026-08-03

- Point Chrome extension install, review, and side-panel commands at the
  published Indiecorns Web Store item.

## 0.3.38 - 2026-08-01

- Add the Chrome extension as the fourth quick-start action across human and
  agent output, with installation verified by a signed-in extension session.
- Add `extension install` and optional `extension review` commands without
  credits or rating incentives.

## 0.3.37 - 2026-07-31

- Ignore stale server readiness commands that point back to an already
  completed CLI bootstrap action.
- Keep human and agent output aligned on the next unfinished quick-start task.

## 0.3.36 - 2026-07-31

- Restore `app.indiecorns.com` as the production API and browser-auth host.
- Make `npx --yes indiecorns@latest` complete browser sign-in and continue to
  the real next setup action without separate `login` or `tasks` commands.
- Keep the CLI install step completed from a valid local token when the task
  API is temporarily unavailable, and normalize the API's `cli_install` key.

## 0.3.35 - 2026-07-27

- Switch the default app to the migrated Indiecorns production app and use its
  device-code login flow with a single-use exchange and 30-day Bearer token.
- Route tasks, agent plans, profiles, community targets, events, launches,
  posts, and Indie Hackers autofill through the new stable public CLI API.
- Preserve the legacy session-header and endpoint contract as a fallback for
  older deployments during the cutover.
- Add an end-to-end local API test covering login, polling, single exchange,
  Bearer authentication, tasks, profile saves, launches, posts, and events.

## 0.3.34 - 2026-07-20

- Cache `profile set` values locally so existing profiles remain available when
  the app session is stale or unavailable.
- Merge local and live existing profiles into `indiehackers fill-profile`, so
  the Indie Hackers fill plan can include saved website, X, GitHub, LinkedIn,
  Product Hunt, and Peerlist profile fields without requiring a fresh app plan.

## 0.3.33 - 2026-07-20

- Add `indiehackers fill-profile` to return an agent-safe Indie Hackers profile
  fill plan for `https://www.indiehackers.com/danielsinewe/editing`.
- Add Indie Hackers profile parsing and `profile set indiehackers` support for
  saved Indiecorns social links.
- Update packaged Indiecorns skill docs so agents can discover the profile fill
  workflow from the public npm package.

## 0.3.32 - 2026-07-20

- Add `peerlist-launches` as a Monday-gated Peerlist project launch queue that
  returns upvote and 5-star rating targets with after-proof record commands.
- Treat `rate` as a first-class community action for Peerlist launch targets and
  store bounded rating metadata when recording completed external actions.
- Update packaged Indiecorns skill docs so agents can discover the new weekly
  launch support flow from the public npm package.

## 0.3.31 - 2026-07-13

- Preserve the current Codex adapter and package layout from `0.3.29` while
  shipping the clearer Slack onboarding and member-follow workflow from
  `0.3.30`.
- Update the declared npm package manager to the current supported release.

## 0.3.30 - 2026-07-13

- Add `follow-members` for opening or listing Indiecorns member profiles across
  Peerlist, X, and Product Hunt, with agent-safe JSON targets and record
  commands.
- Allow `record` to save follow events for Peerlist, X, and Product Hunt
  platform targets.
- Replace the expired Discord setup step with the Indiecorns Slack workspace.
- Reduce quick start to three explicit steps: connect the CLI, add a public
  website, and join Slack. Human output now shows one next command at a time.

## 0.3.29 - 2026-06-23

- Install the public `indiecorns` skill automatically with the local agent
  plugin and report its installation state in agent and wizard output.

## 0.3.27 - 2026-05-31

- Correct CLI version detection when `npx indiecorns` is launched from inside
  another local `indiecorns` package checkout.

## 0.3.26 - 2026-05-31

- Always send a CLI package version when creating browser login sessions, with
  a local fallback when the app response omits session metadata.

## 0.3.25 - 2026-05-31

- Send the current CLI version on authenticated app API requests so the
  dashboard can refresh stale install-version evidence after users upgrade.

## 0.3.24 - 2026-05-31

- Hide internal PostHog diagnostics from the default user-facing wizard output.
  Developer checks remain available through `indiecorns doctor`.

## 0.3.23 - 2026-05-31

- Replace the hard-to-read terminal ASCII banner with a compact Indiecorns logo
  mark that renders consistently in `npx indiecorns`.

## 0.3.22 - 2026-05-31

- Document the durable Indiecorns CLI release path inside the bundled plugin,
  including the public `danielsinewe/indiecorns-cli` publishing source,
  machine-readable CLI output guardrails, and npm verification commands.

## 0.3.21 - 2026-05-31

- Make the human CLI flows warmer and more guided with an Indiecorns branded
  terminal header, TTY spinner states, clearer wizard sections, and more helpful
  login/task/run next steps.
- Keep `--json`, `--agent`, and `wizard --ndjson` outputs machine-readable so
  agents can continue orchestrating the CLI without parsing human terminal UI.

## 0.3.17 - 2026-05-27

- Point public npm metadata at the dedicated open-source CLI repository.
- Keep the broader Indiecorns app monorepo private while exposing the audited
  CLI and agent plugin package surface.

## 0.3.16 - 2026-05-27

- Switch the public package license to MIT and include a root license file.
- Align the advertised Node.js engine with the published CLI dependency graph.
- Mark npm as the root package manager for the published package workspace.
- Add npm trusted-publishing workflow configuration for future provenance-based
  releases.

## 0.3.15 - 2026-05-27

- Replace the npm README with CLI-first package documentation.
- Add npm discovery and support metadata.
- Remove unused public package dependencies.
- Keep local Clerk state out of accidental nested app packages.
