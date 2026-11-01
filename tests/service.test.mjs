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
  assert.throws(() => serviceDefinition({ system: 'win32', cli: 'C:/cli' }), /supports/)
})
