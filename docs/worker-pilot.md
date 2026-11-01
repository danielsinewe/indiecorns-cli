# Continuous worker pilot — 1 November 2026

## Current verified behavior

Daniel’s authenticated macOS launchd service continuously discovers community
profiles, projects and posts, scrapes public pages, and creates local support
briefs. The shared community feed verifies eight active human Slack members.
Two exact member mappings cover four public profiles; newly mapped targets were
picked up during the normal unattended refresh and received owner priority.

The pilot retains 66 targets, one completed GitHub-star receipt and one daily
external-action attempt. The star was independently verified remotely. Its
account-bound policy permits the designated repository and one member profile
under the same daily quota; this is not broad
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
0.4.2 established public npm releases through validated GitHub trusted publishing.
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

Release 0.4.4 adds local minute-by-minute health samples and a
`worker health --hours 24` report. Tests distinguish a complete sample window
from short history, restart gaps, expected sleep, stalled progress and corrupted
records. History is capped at three 1 MiB daily files and contains no URLs,
messages or credentials. All 81 tests, packaged startup and three-OS CI passed.
The live managed service recorded its first real minute heartbeat, with queue,
policy, receipts and quota preserved. History began at 21:12 UTC on 1 November;
earlier status checks are not retroactively converted into uptime samples.

The 0.4.5 candidate discovers linked public issue indexes and posts from observed
GitHub repositories and adds opt-in issue thumbs-up reactions. A separate exact
issue allowlist is required; existing policies enable none. Tests cover public
repository/actor proof, pagination, after-write verification, receipt recovery,
shared quota and atomic policy revocation. A live public issue-index scrape found
twenty post candidates. A real API preflight completed four read requests with its
write intercepted before HTTP dispatch; no reaction was sent or recorded. Three
checked community repositories had no issues, so no live issue was allowlisted.
Issue listings refresh every fifteen minutes within the existing host budgets.
Local validation passes 92 tests and packaged startup verification.

## Remaining release and validation work

- Release issue discovery/reactions and verify the installed runtime, preserving
  queue, policy, receipts, daily quota and accumulated health history.
- Validate a real account-authorized follow when provider authentication and the
  pilot’s unchanged daily quota permit it.
- Validate a live issue reaction when a relevant public issue and quota are
  available; no synthetic post or engagement should substitute for that evidence.
- Validate sustained unattended operation beyond the pilot so far. The machine
  must be awake and online; no full-day, logout or sleep-continuity claim is made.
- Extend platform action support beyond the GitHub adapters and local
  briefs. Other platforms’ engagement actions are not implemented by this worker.
- Continue validating storage growth as community volume increases; durable
  pending work and receipts deliberately have no automatic hard disk quota.
