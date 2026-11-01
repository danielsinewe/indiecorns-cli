# Continuous worker pilot — 1 November 2026

## Current verified behavior

Daniel’s authenticated macOS launchd service continuously discovers community
profiles, projects and posts, scrapes public pages, and creates local support
briefs. The shared community feed verifies eight active human Slack members.
Two exact member mappings cover four public profiles; newly mapped targets were
picked up during the normal unattended refresh and received owner priority.

The pilot retains 70 targets, one completed GitHub-star receipt and one daily
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

Release 0.4.5 discovers linked public issue indexes and posts from observed
GitHub repositories and adds opt-in issue thumbs-up reactions. A separate exact
issue allowlist is required; existing policies enable none. Tests cover public
repository/actor proof, pagination, after-write verification, receipt recovery,
shared quota and atomic policy revocation. A live public issue-index scrape found
twenty post candidates. A real API preflight completed four read requests with its
write intercepted before HTTP dispatch; no reaction was sent or recorded. Three
checked community repositories had no issues, so no live issue was allowlisted.
Issue listings refresh every fifteen minutes within the existing host budgets.
Local validation passes 92 tests and packaged startup verification.
Its public package and live managed-service upgrade passed, preserving accumulated
health history. Four issue indexes were observed automatically; no reaction was
enabled or executed.

Release 0.4.6 adds read-only public search for recent issues authored by
explicitly mapped Slack members. Numeric GitHub identities and current membership
are required for author priority outside a member-owned namespace. A live isolated
probe made four GET requests, found Daniel’s public issue in Stieges/bpmn-generator,
and assigned verified author priority without changing the live queue or sending
writes. Poll reservations, pagination, partial-result detection, provider limits,
evidence expiry and credential-change recovery are tested. Optional source health
is recorded without retroactively claiming it for older samples.
Its public package is installed on the Mac. The normal worker discovered and
scraped the verified member-authored issue automatically, increasing the queue
from 70 to 71 targets while preserving policy, budget, receipts and health history.

Release 0.4.7 adds an optional star/follow scope for freshly verified Slack
members and their observed public repositories. Exact identity mappings and
current membership are required; target flags cannot authorize an action.
Self-actions are excluded after a numeric GitHub actor check. Membership is
rechecked before writing, and existing quota and receipt keys are shared across
both policy scopes. Existing policies enable no member-wide actions.
The published runtime is installed and the pilot uses the member-wide scope with
its original one-action daily cap. Prior exact user/repository lists were cleared;
completed receipts still prevent replay. Its current process and minute heartbeat
passed readback after npm cache removal, retaining all 71 targets and health history.

The 0.4.8 candidate adds exact-allowlisted Product Hunt profile follows through its
documented API, with a separate credential, identity/relationship proof, a shared
daily action budget and independent provider cooldowns. There is no configured
Product Hunt credential or verified live follow. Provider approval and user-level
write scopes are required. A read-only check of all eight Slack profiles found no
structured public social links, so no additional identity mappings were inferred.
Both queued Product Hunt profiles are unavailable to the public HTML scraper.
Configured credentials now enable official API profile observation before action
work, with persisted provider cooldowns; this path is covered by a real CLI test
using a closed mock transport, not by a verified live Product Hunt session.

## Remaining release and validation work

- Release the Product Hunt adapter and verify its installed runtime, preserving
  queue, policy, receipts, daily quota and accumulated health history.
- Validate a real account-authorized follow when provider authentication and the
  pilot’s unchanged daily quota permit it.
- Validate a live issue reaction when a relevant public issue and quota are
  available; no synthetic post or engagement should substitute for that evidence.
- Validate sustained unattended operation beyond the pilot so far. The machine
  must be awake and online; no full-day, logout or sleep-continuity claim is made.
- Verify Product Hunt live authentication/follow proof and extend support for
  other platform actions. Their engagement actions are not implemented by this worker.
- Continue validating storage growth as community volume increases; durable
  pending work and receipts deliberately have no automatic hard disk quota.
