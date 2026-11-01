# Continuous worker pilot — 1 November 2026

## Current verified behavior

Daniel’s authenticated macOS launchd service continuously discovers community
profiles, projects and posts, scrapes public pages, and creates local support
briefs. The shared community feed verifies eight active human Slack members.
Two exact member mappings cover four public profiles; newly mapped targets were
picked up during the normal unattended refresh and received owner priority.

The pilot retains 43 targets, one completed GitHub-star receipt and one daily
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
permanent runtime operation after removal of the npm execution cache. The current
0.4.2 candidate adds archived-priority regression coverage. Local validation passes
72 tests, smoke/pack checks and packaged runtime verification. Cross-platform CI
must pass for this candidate before it is merged.

## Remaining release and validation work

- Publish the reviewed candidate and verify installation from the public npm
  registry outside this checkout. npm requires password/security-key
  reauthentication; both available publishing paths failed authentication.
- Switch the Mac pilot from its checkout to the verified published runtime.
- Validate sustained unattended operation beyond the pilot so far. The machine
  must be awake and online; no full-day, logout or sleep-continuity claim is made.
- Extend platform action support beyond the current GitHub-star adapter and local
  briefs. Other platforms’ engagement actions are not implemented by this worker.
- Continue validating storage growth as community volume increases; durable
  pending work and receipts deliberately have no automatic hard disk quota.
