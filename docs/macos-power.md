# Optional macOS power helpers

These commands do not change the normal worker installation or restart it.
The default is **off**. Linux and Windows return an unsupported-platform plan.
No desktop app is required. No power setting is changed by producing a plan or
installer package.

## Closed-lid mode

1. `indiecorns worker power setup --mode closed-lid` previews the effects.
2. `indiecorns worker power helper-package --output /absolute/new-directory`
   creates a small reviewable package for the currently installed same-user
   worker. It includes the helper, binding, launchd definition, checksums and
   install/uninstall scripts. It does **not** install or run them.
3. After reviewing it, run the returned `installCommand` in a terminal. This
   requires one administrator authorization. Installation leaves prevention off.
4. Explicitly opt into a bounded session:
   `indiecorns worker power setup --mode closed-lid --minutes 30 --enable --accept-power-impact`.
5. Inspect `indiecorns worker power status --mode closed-lid`, or stop using
   `indiecorns worker power disable --mode closed-lid`.
6. `indiecorns worker power uninstall --mode closed-lid` requests release first.
   After an acknowledged `uninstallReady` receipt, the reviewed `uninstall.sh`
   removes the administrator-owned helper. It also verifies recovery itself and
   refuses removal if restore fails. Administrator authorization is required for
   removal, not each enable/disable request.

The CLI and the community worker stay unprivileged. The installer copies the
existing Node runtime (Node 22.22+ / 24+, including SQLite) and standalone helper
into root-owned `/Library/Indiecorns/PowerHelper`. It verifies the copied hashes
before execution. The daemon never executes the user-writable runtime or CLI.
An existing installation is preserved; replacement requires an explicit uninstall.
There are no sudoers entries, wildcard commands, networking, model calls or
external dependencies in the privileged component.

The root daemon has a fixed, member-owned 0600 request file inside a root-owned
directory. It checks file ownership, permissions, type, link count, size and
no-follow opens. It accepts only a strict JSON enable/disable/uninstall protocol.
Enable needs explicit system-wide opt-in, a fresh request, 1–120 minutes, AC
power and the installed worker's UID, exact command, PID and start time. It never
accepts an executable, command arguments, shell fragment or path in a request.
Same-user software can request this capability; it is not an account attestation.

Only `pmset -a disablesleep 1` and the recorded restore value `0` are privileged
writes. A known original `SleepDisabled 0` is required; an unknown value or an
already-disabled system is refused. A root-owned, fsynced journal is persisted
**before** changing the setting. Enabling twice does not extend a lease.

The watchdog checks every second, subject to bounded OS-command latency. Deadline,
backward clock movement, monotonic timeout, AC loss, worker exit/replacement or an
unreadable check triggers restoration. External changes to `0` are preserved.
Another program writing the same value `1` cannot be attributed; this limitation
is explicit. Do not run competing sleep-prevention tools during a session.

After SIGKILL or reboot, launchd restarts the helper. It restores any prepared,
active or failed-restore journal before accepting work; it never resumes or
renews the old lease. A kernel-backed SQLite lock excludes concurrent helpers
and uninstall recovery. A failed restore retains the journal, publishes
`restore_failed` and retries. Deinstallation stops rather than deleting recovery
evidence when restoration is unknown or fails.

## Idle-only mode

`indiecorns worker power setup --minutes 30` is a read-only plan. Add
`--enable --accept-power-impact` to explicitly register a separate user LaunchAgent.
It uses `/usr/bin/caffeinate -s -t <remaining-seconds> -w <worker-pid>`: an AC-only,
finite assertion without changing system preferences. The display may sleep.
The helper checks the worker lock identity and a fixed absolute deadline.
An expired session is not renewed at login. There is no KeepAlive restart loop.
`worker power disable` stops only this helper; `worker power uninstall` also
removes its copied module. The main worker and its queues remain untouched.
Kernel timeout bounds an assertion even if the supervising helper is killed.
This mode does **not** claim to override lid-triggered sleep.

## Evidence and hardware limits

All automated tests use injected OS, clock and launchd/process adapters or
temporary files. They do not install the root daemon, invoke privileged power
writes, restart the real worker or prove operation on Daniel's Mac. A separately
authorized hardware test is still needed for lid closure, AC removal, heat,
forced helper crash, login/reboot and uninstall on each supported macOS/CPU family.

Use a ventilated surface, never a bag. The system-wide setting can suppress
normal sleep protections; this implementation does not measure temperature or
promise thermal safety. AC-only operation and a finite timer reduce exposure but
are not hardware validation. Keep-awake also cannot preserve a ChatGPT browser
session or prove successful/continuous member-post discovery.

The implementation follows Apple's source distinction between the system sleep
kill switch and ordinary assertions:

- [Apple pmset source](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmset/pmset.m)
- [Apple kernel power management](https://github.com/apple-oss-distributions/xnu/blob/main/iokit/Kernel/IOPMrootDomain.cpp)
- [OpenLid architecture](https://github.com/openlid/openlid/blob/main/docs/ARCHITECTURE.md)
- [nosleep CLI reference](https://github.com/ppikrorngarn/nosleep/blob/main/cli/nosleep.sh)

The latter reference's unconditional restore and sudoers setup are not copied.
