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

Release 0.4.3 adds opt-in GitHub follows under a separate exact user allowlist,
sharing the star adapter’s quota and provider cooldown. All 77 tests, packaged
startup verification and three-OS CI passed. The pilot is running the published
managed runtime. Its refreshed GitHub credential’s actor and follow permission
were verified, and one exact Slack-member profile is allowlisted. No follow has
been executed: the unchanged one-action-per-day quota was used by the earlier
star. The next quota day begins at midnight UTC.

The 0.4.4 candidate adds local minute-by-minute health samples and a
`worker health --hours 24` report. Tests distinguish a complete sample window
from short history, restart gaps, expected sleep, stalled progress and corrupted
records. History is capped at three 1 MiB daily files and contains no URLs,
messages or credentials. Local validation passes 81 tests and packaged startup.
Real full-day evidence starts only when this recorder is installed; earlier
status checks are not retroactively converted into uptime samples.

## Remaining release and validation work

- Release the health recorder and verify real minute samples from the installed
  runtime while preserving the queue, policy, receipts and daily quota.
- Validate a real account-authorized follow when provider authentication and the
  pilot’s unchanged daily quota permit it.
- Validate sustained unattended operation beyond the pilot so far. The machine
  must be awake and online; no full-day, logout or sleep-continuity claim is made.
- Extend platform action support beyond the GitHub adapters and local
  briefs. Other platforms’ engagement actions are not implemented by this worker.
- Continue validating storage growth as community volume increases; durable
  pending work and receipts deliberately have no automatic hard disk quota.
