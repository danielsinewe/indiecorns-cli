import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { posix, win32, dirname, join } from 'node:path'
import { homedir, platform } from 'node:os'
import { spawnSync } from 'node:child_process'
const label = 'com.indiecorns.worker'
const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'"
const windowsQuote = value => '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"'
const xml = value => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
const unitQuote = value => '"' + String(value).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, () => '$$') + '"'
export function serviceDefinition({ system = platform(), home = homedir(), node = process.execPath, cli, interval = 300, userId, windowsRoot = process.env.SystemRoot ?? 'C:\\Windows' }) {
  if (!cli || !Number.isInteger(interval) || interval < 1) throw new Error('Invalid service configuration')
  if ([home, node, cli].some(value => /[\n\r\0]/.test(value))) throw new Error('Invalid service path')
  const args = [node, cli, 'worker', 'run', '--interval-seconds', String(interval), '--no-telemetry']
  if (system === 'darwin') return {
    path: posix.join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer>
<key>ProcessType</key><string>Background</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string></dict>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>`,
  }
  if (system === 'linux') return {
    path: posix.join(home, '.config', 'systemd', 'user', 'indiecorns-worker.service'),
    content: `[Unit]\nDescription=Indiecorns community worker\nAfter=network-online.target\n\n[Service]\nExecStart=${args.map(unitQuote).join(' ')}\nRestart=always\nRestartSec=30\nEnvironment=${unitQuote(`HOME=${home}`)}\nStandardOutput=null\nStandardError=null\n\n[Install]\nWantedBy=default.target\n`,
  }
  if (system === 'win32') {
    if (!/^S-\d+(?:-\d+)+$/.test(userId ?? '')) throw new Error('A Windows user SID is required')
    const taskName = `IndiecornsWorker-${userId}`
    const launcherPath = win32.join(home, '.indiecorns', 'worker', 'worker-launcher.ps1')
    const powershell = win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const argumentsText = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', launcherPath].map(windowsQuote).join(' ')
    return {
      path: win32.join(home, '.indiecorns', 'worker', 'worker-task.xml'), taskName, launcherPath,
      // ProcessStartInfo receives a literal executable and prequoted arguments;
      // page content and credentials never enter the generated launcher. The parent
      // supervises child exits directly; Task Scheduler also recovers parent exits.
      launcherContent: '\uFEFF' + `$ErrorActionPreference = 'Stop'\n$startInfo = New-Object System.Diagnostics.ProcessStartInfo\n$startInfo.FileName = ${psQuote(node)}\n$startInfo.Arguments = ${psQuote(args.slice(1).map(windowsQuote).join(' '))}\n$startInfo.UseShellExecute = $false\n$startInfo.CreateNoWindow = $true\nwhile ($true) {\n  $worker = New-Object System.Diagnostics.Process\n  $worker.StartInfo = $startInfo\n  try {\n    if (-not $worker.Start()) { throw 'Cannot start Indiecorns worker' }\n    $worker.WaitForExit()\n  } finally { $worker.Dispose() }\n  Start-Sleep -Seconds 30\n}\n`,
      content: `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Indiecorns community worker</Description></RegistrationInfo>
<Triggers>
<LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger>
<TimeTrigger><Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2000-01-01T00:00:00Z</StartBoundary><Enabled>true</Enabled></TimeTrigger>
</Triggers>
<Principals><Principal id="Member"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>true</Hidden><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure></Settings>
<Actions Context="Member"><Exec><Command>${xml(powershell)}</Command><Arguments>${xml(argumentsText)}</Arguments></Exec></Actions>
</Task>`,
    }
  }
  throw new Error('Worker service installation supports macOS, Linux and Windows; use worker run on other systems')
}
export function manageService(action, options) {
  const system = options.system ?? platform()
  const run = (command, args, allowMissing = false) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0 && !allowMissing) throw new Error(`${command} failed (${result.status}): ${result.stderr?.trim()}`)
    return result
  }
  let userId = options.userId
  if (system === 'win32' && !userId) {
    const identity = run('whoami.exe', ['/user', '/fo', 'csv', '/nh']).stdout
    userId = identity.match(/S-\d+(?:-\d+)+/)?.[0]
  }
  const definition = serviceDefinition({...options, userId})
  const stopWindowsWorker = () => {
    let lock
    try { lock = JSON.parse(readFileSync(join(options.home ?? homedir(), '.indiecorns', 'worker', 'worker.lock'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (!Number.isSafeInteger(lock.pid) || lock.pid <= 0) throw new Error('Invalid worker process identity')
    // Task Scheduler can stop its launcher without terminating the child. Check
    // the executable AND exact CLI path before terminating the lock's process.
    const script = `$candidate = Get-CimInstance Win32_Process -Filter 'ProcessId = ${lock.pid}' -ErrorAction Stop; if ($candidate -and $candidate.ExecutablePath -and $candidate.CommandLine -and $candidate.ExecutablePath.Equals(${psQuote(options.node ?? process.execPath)}, [StringComparison]::OrdinalIgnoreCase) -and $candidate.CommandLine.IndexOf(${psQuote(options.cli)}, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $candidate.CommandLine -match 'worker["\\s]+run') { Stop-Process -Id ${lock.pid} -Force -ErrorAction Stop }`
    run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script])
  }
  const domain = `gui/${process.getuid?.()}`
  if (action === 'install') {
    mkdirSync(dirname(definition.path), { recursive: true })
    writeFileSync(definition.path, system === 'win32' ? Buffer.from('\uFEFF' + definition.content, 'utf16le') : definition.content, { mode: 0o600 })
    if (system === 'win32') {
      writeFileSync(definition.launcherPath, definition.launcherContent, {mode:0o600})
      run('schtasks.exe', ['/End', '/TN', definition.taskName], true)
      stopWindowsWorker()
      run('schtasks.exe', ['/Create', '/TN', definition.taskName, '/XML', definition.path, '/F'])
      run('schtasks.exe', ['/Run', '/TN', definition.taskName])
    } else if (system === 'darwin') {
      run('launchctl', ['bootout', `${domain}/${label}`], true)
      // bootout returns before launchd has necessarily removed the old job.
      let loaded = false
      for (let attempt = 0; attempt < 20; attempt++) {
        const result = run('launchctl', ['bootstrap', domain, definition.path], true)
        if (result.status === 0) { loaded = true; break }
        if (result.status !== 5) throw new Error(`launchctl bootstrap failed (${result.status})`)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
      }
      if (!loaded) throw new Error('launchd did not accept the worker service; inspect worker service-status')
    } else {
      run('systemctl', ['--user', 'daemon-reload'])
      run('systemctl', ['--user', 'enable', '--now', 'indiecorns-worker.service'])
      run('systemctl', ['--user', 'restart', 'indiecorns-worker.service'])
    }
    return { installed: true, path: definition.path }
  }
  if (action === 'uninstall') {
    if (system === 'win32') {
      run('schtasks.exe', ['/End', '/TN', definition.taskName], true)
      run('schtasks.exe', ['/Delete', '/TN', definition.taskName, '/F'], true)
      stopWindowsWorker()
      rmSync(definition.launcherPath, {force:true})
    } else if (system === 'darwin') run('launchctl', ['bootout', `${domain}/${label}`], true)
    else run('systemctl', ['--user', 'disable', '--now', 'indiecorns-worker.service'], true)
    rmSync(definition.path, { force: true })
    if (system === 'linux') run('systemctl', ['--user', 'daemon-reload'])
    return { installed: false }
  }
  if (action === 'service-status') {
    if (system === 'win32') {
      const result = run('schtasks.exe', ['/Query', '/TN', definition.taskName, '/V', '/FO', 'LIST'], true)
      return {registered:result.status === 0, detail:result.stdout?.trim()}
    }
    const result = system === 'darwin'
      ? run('launchctl', ['print', `${domain}/${label}`], true)
      : run('systemctl', ['--user', 'show', 'indiecorns-worker.service', '--property=ActiveState,SubState,MainPID'], true)
    return { registered: result.status === 0, detail: result.stdout?.trim() }
  }
  throw new Error('Unknown service action')
}
