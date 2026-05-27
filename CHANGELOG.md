# Changelog

## 0.3.19 - 2026-05-27

- Add the npm token fallback to the GitHub Actions publish workflow so releases
  can run from the public repository while npm trusted publishing awaits account
  2FA approval.

## 0.3.18 - 2026-05-27

- Make the public source repository self-contained by replacing private
  monorepo proxy scripts with package-local CLI, smoke, and pack checks.
- Add open-source maintenance docs and CI for install, smoke, and package
  content verification.

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
