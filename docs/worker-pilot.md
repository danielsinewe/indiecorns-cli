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
- Obtain verified Slack channel membership and map it to community identities.
- Add configured external action execution with proof and replay protection.
- Support Windows startup and verify Linux supervision on a Linux host.
- Handle discovery pagination/capacity and long-term retention at larger scale.
- Publish the reviewed CLI release and verify installation outside this checkout.
- Validate sustained unattended operation, beyond the short pilot so far.

A desktop computer must be awake and online for local workers to run. The pilot
has not established continuous operation through sleep, logout, or a full day.
