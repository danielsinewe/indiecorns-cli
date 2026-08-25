# Changelog

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
