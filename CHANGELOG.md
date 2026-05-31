# Changelog

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
