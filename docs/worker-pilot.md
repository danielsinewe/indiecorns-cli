# Continuous worker pilot — 1 November 2026

## Current verified behavior

Daniel’s authenticated macOS launchd service continuously discovers community
profiles, projects and posts, scrapes public pages, and creates local support
briefs. The shared community feed verifies eight active human Slack members.
Two exact member mappings cover four public profiles; newly mapped targets were
picked up during the normal unattended refresh and received owner priority.

The pilot retains 66 targets, one completed GitHub-star receipt and one daily
external-action attempt. The star was independently verified remotely. Its
account-bound policy permits only the designated repository; this is not broad
permission to write messages or perform other platform actions.

Forced termination demonstrated automatic launchd recovery without losing jobs,
action receipts or quota. SQLite holds exclusive worker ownership independently
of PID metadata and releases ownership when the process dies. Concurrent-process
tests cover stale recovery and lost metadata. Supported worker runtimes are
Node.js 22.22 LTS or Node.js 24+; ordinary CLI commands also support Node.js 20.

## Discovery, storage and distribution

All 13 configured API discovery sources completed authenticated production reads.
Both backend handlers support bounded pagination. The shared Slack feed is live
on app.indiecorns.com; Slack provider credentials remain on the server. Public
scraping respects robots rules and host delays, rejects private network addresses,
and bounds response sizes. API errors and cooldowns persist across restarts.

At most 2,000 job payloads remain loaded after each cycle. Overflow payloads stay
on disk with a durable scheduling index. Current Slack membership applies to both
loaded and archived jobs before observation selection. Existing indexes are
upgraded one payload at a time. Thirty-day retention retires inactive successful
observations while preserving pending work and external-action receipts.
This bounds loaded payloads, not total disk usage.

Native macOS, Linux and Windows CI previously verified packaged startup, Linux
systemd supervision, Windows Task Scheduler startup and crash recovery, and
permanent runtime operation after removal of the npm execution cache. Release
0.4.2 is published as npm latest through validated GitHub trusted publishing.
An isolated public-registry installation and a real managed-service migration
passed. The Mac service recovered after its npm cache was deleted and its process
was forcibly terminated, retaining all 66 targets, its receipt and daily quota.

The 0.4.3 candidate adds opt-in GitHub follows under a separate exact user
allowlist, sharing the star adapter’s quota and provider cooldown. Local validation
passes 77 tests and packaged startup verification. No follow has been executed in
the pilot: the existing credential lacks the required provider permission, and
the current policy enables no follows. Cross-platform CI must pass before release.

## Remaining release and validation work

- Release the reviewed follow candidate and verify the installed runtime.
- Validate a real account-authorized follow when provider authentication and the
  pilot’s unchanged daily quota permit it.
- Validate sustained unattended operation beyond the pilot so far. The machine
  must be awake and online; no full-day, logout or sleep-continuity claim is made.
- Extend platform action support beyond the GitHub adapters and local
  briefs. Other platforms’ engagement actions are not implemented by this worker.
- Continue validating storage growth as community volume increases; durable
  pending work and receipts deliberately have no automatic hard disk quota.
