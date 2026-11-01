import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { posix, dirname } from 'node:path'
import { homedir, platform } from 'node:os'
import { spawnSync } from 'node:child_process'
const label = 'com.indiecorns.worker'
const xml = value => String(value).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
const unitQuote = value => '"' + String(value).replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, () => '$$') + '"'
export function serviceDefinition({ system = platform(), home = homedir(), node = process.execPath, cli, interval = 300 }) {
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
  throw new Error('Worker service installation supports macOS and Linux; use worker run on other systems')
}
export function manageService(action, options) {
  const system = options.system ?? platform()
  const definition = serviceDefinition(options)
  const run = (command, args, allowMissing = false) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0 && !allowMissing) throw new Error(`${command} failed (${result.status}): ${result.stderr?.trim()}`)
    return result
  }
  const domain = `gui/${process.getuid?.()}`
  if (action === 'install') {
    mkdirSync(dirname(definition.path), { recursive: true })
    writeFileSync(definition.path, definition.content, { mode: 0o600 })
    if (system === 'darwin') {
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
    if (system === 'darwin') run('launchctl', ['bootout', `${domain}/${label}`], true)
    else run('systemctl', ['--user', 'disable', '--now', 'indiecorns-worker.service'], true)
    rmSync(definition.path, { force: true })
    if (system === 'linux') run('systemctl', ['--user', 'daemon-reload'])
    return { installed: false }
  }
  if (action === 'service-status') {
    const result = system === 'darwin'
      ? run('launchctl', ['print', `${domain}/${label}`], true)
      : run('systemctl', ['--user', 'show', 'indiecorns-worker.service', '--property=ActiveState,SubState,MainPID'], true)
    return { registered: result.status === 0, detail: result.stdout?.trim() }
  }
  throw new Error('Unknown service action')
}
