# Continuous worker pilot — 1 November 2026

An authenticated macOS launchd pilot is running from this checkout. OS process
inspection confirmed a live service. A forced process termination was followed
by automatic restart and recovery of the persisted queue.

The expanded discovery cycle successfully queried all 13 configured sources
across Peerlist, X, LinkedIn and Product Hunt. The API supplied one profile and
no post or project targets during this cycle. Public-page scraping of that
profile independently found two member-path project links. Both project pages
were then scraped automatically. Three observations are persisted locally;
none was recorded as a completed engagement or verified authorship claim.

Tests cover source selection, Retry-After persistence, bounded responses,
robots denial, crawl delays, host cooldowns, public-address restrictions,
metadata parsing, attribution, crash recovery, ownership, corrupt-state handling,
deduplication, independent observation scheduling, and service configuration.

Remaining goal requirements:
- Extend exact public-profile mappings beyond the first verified member.
- Add the remaining platform executors; a real GitHub action is now verified.
- Keep startup/recovery verification passing on all three supported operating systems.
- Handle discovery pagination and long-term retention at larger scale.
- Publish the reviewed CLI release and verify installation outside this checkout.
- Validate sustained unattended operation, beyond the short pilot so far.

A desktop computer must be awake and online for local workers to run. The pilot
has not established continuous operation through sleep, logout, or a full day.

The ChatGPT in-app browser subsequently verified all eight members of the
community channel. One member's explicit project link was mapped to their Slack
identity. The worker prioritized and observed that project and now maintains four
local support briefs. The private roster expires after 24 hours; no read-capable
Slack Web API credential is configured yet. The implementation supports paginated,
workspace-verified refresh when credentials are supplied.

An opt-in GitHub-star adapter now reserves quota before execution and verifies
remote state before/after idempotent writes. It has passed mocked API and replay
tests; the live pilot has made no external engagement writes. Default actions
only create local evidence briefs. CI now runs the full suite on macOS, Linux
and Windows and has verified real Linux systemd supervision on its Linux runner.

Windows Task Scheduler support now includes per-user identity, hidden execution,
login/recurring triggers, no runtime limit, and crash restart. CI checks out the
repository into a path containing spaces on all operating systems and adds an
actual Windows scheduled-start/forced-crash test. This checkpoint does not yet
claim that the Windows supervision test has passed.

Subsequent verification: Windows Task Scheduler startup and forced worker crash
recovery passed in CI run 41320012015 at commit 89328c0, together with the macOS
and Linux checks. The launcher supervises child exits directly every 30 seconds;
Task Scheduler separately recovers parent exits. No Mac restart was needed for
these Windows-only changes.

The existing community Slack app was authorized for three read-only scopes and
added to the configured community channel. Its credential is stored privately,
not in the repository. Live API roster verification returned eight active human
members. The running Mac worker independently refreshed that roster and scheduled
its next refresh. A live channel-history read found 11 shared links across five
platform types. The worker now has 14 deduplicated targets and has produced eight
local briefs at the latest inspection. Shared-link priority does not assert that
the sharing member owns the linked external project. Message bodies are not
persisted. External engagement has still not been executed in the pilot.

The member's publicly published GitHub profile was explicitly linked from the
already mapped public community profile. The worker seeded that known profile,
read its public repository links, and automatically discovered six repositories.
One exact repository was allowlisted with an execution policy bound to the current
community account and a one-action daily cap. The worker observed the repository,
checked that it was not already starred, performed the star, and verified it.
An independent authenticated GitHub read changed from 404 before execution to 204
after execution. The receipt records `alreadyPresent: false`. After restart the
receipt timestamp and daily attempt count remained unchanged at one.

At this inspection the live pilot has 41 targets and 35 local briefs. The code
has 54 passing local tests. Windows startup/recovery/cleanup and permanent-runtime
installation passed in three-OS CI run 41323577404 at commit a793de0. Remaining release and scale work is still open;
this is not a claim that every platform can execute engagement actions.

The background installer now avoids disposable npm execution-cache paths. It
verifies and installs an exact published CLI release into a private versioned
runtime when invoked from `npx`, while reusing global installs and checkouts.
Registration stores the real executable paths for later uninstall, and cleanup
retains the active release plus one rollback release. A real packaged npm install
was exercised in an isolated temporary home: after deleting the execution cache,
the permanent packaged CLI still imported its dependencies, started its worker,
persisted the expected authentication-required state, and released its lock. All temporary test files were removed. This package-level check
is also part of three-OS CI; public-registry release verification is still pending.

The former 2,000-target admission failure is replaced by a durable payload backlog.
An isolated 2,050-target test accepts the whole batch, observes a Slack member first,
then repeatedly restarts and rediscovers the batch without resetting observation
cooldowns or losing targets. Each completed cycle leaves at most 2,000 loaded jobs.
Cold payloads are atomically written before the state index is committed and retained
after promotion, so the previously committed state can still recover after a crash.
Missing payloads fail closed while preserving the committed index and action receipts.
This bounds loaded job payloads, not total disk consumption: the compact index and
durable evidence still grow; automatic age-based retention is not yet implemented.
