import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceDefinition } from '../indiecorns/lib/service.mjs'

test('launchd supervises the worker without growing log files', () => {
  const definition = serviceDefinition({ system: 'darwin', home: '/tmp/member', node: '/usr/local/bin/node', cli: '/tmp/a & b/cli.mjs' })
  assert.match(definition.path, /LaunchAgents\/com.indiecorns.worker.plist$/)
  assert.match(definition.content, /a &amp; b/)
  assert.match(definition.content, /<key>KeepAlive<\/key><true\/>/)
  assert.match(definition.content, /<key>ThrottleInterval<\/key><integer>30/)
  assert.match(definition.content, /<key>StandardOutPath<\/key><string>\/dev\/null/)
})

test('systemd quotes paths and does not expand percent and dollar expressions', () => {
  const definition = serviceDefinition({ system: 'linux', home: '/home/member', node: '/usr/bin/node', cli: '/tmp/with space/%f/$NAME.mjs' })
  assert.match(definition.content, /%%f\/\$\$NAME/)
  assert.match(definition.content, /Restart=always/)
  assert.match(definition.content, /WantedBy=default.target/)
  assert.match(definition.content, /StandardOutput=null/)
})

test('service configuration rejects malformed paths and intervals', () => {
  assert.throws(() => serviceDefinition({ system: 'linux', cli: '/tmp/a\nExecStart=bad' }), /path/)
  assert.throws(() => serviceDefinition({ cli: '/tmp/cli', interval: NaN }), /configuration/)
  assert.throws(() => serviceDefinition({ system: 'freebsd', cli: '/tmp/cli' }), /supports/)
})


test('Windows worker runs hidden at login, without a runtime limit, with recurring recovery', () => {
  const definition = serviceDefinition({ system: 'win32', home: "C:\\Users\\O'Neil", node: 'C:\\Program Files\\nodejs\\node.exe', cli: "C:\\Users\\O'Neil\\community worker\\cli.mjs", userId: 'S-1-5-21-123-456-789-1001' })
  assert.match(definition.taskName, /^IndiecornsWorker-S-1-5-/)
  assert.match(definition.content, /encoding="UTF-16"/)
  assert.match(definition.content, /<LogonType>InteractiveToken<\/LogonType>/)
  assert.match(definition.content, /<RunLevel>LeastPrivilege<\/RunLevel>/)
  assert.match(definition.content, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/)
  assert.match(definition.content, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/)
  assert.match(definition.content, /<Interval>PT5M<\/Interval>/)
  assert.match(definition.content, /<RestartOnFailure><Interval>PT1M/)
  assert.match(definition.launcherContent, /CreateNoWindow = \$true/)
  assert.match(definition.launcherContent, /UseShellExecute = \$false/)
  assert.match(definition.launcherContent, /\$worker\.WaitForExit\(\)/)
  assert.match(definition.launcherContent, /\$workerExitCode = \$worker\.ExitCode/)
  assert.match(definition.launcherContent, /O''Neil/)
  assert.ok(definition.launcherContent.includes(`"C:\\Users\\O''Neil\\community worker\\cli.mjs"`))
  assert.throws(() => serviceDefinition({system:'win32',cli:'C:/cli',userId:'bad;command'}), /SID/)
})
