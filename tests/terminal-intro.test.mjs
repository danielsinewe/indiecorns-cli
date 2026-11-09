import test from 'node:test'
import assert from 'node:assert/strict'
import {introOptions,introFrame,showTerminalIntro} from '../indiecorns/lib/terminal-intro.mjs'

const terminal={isTTY:true,columns:100,rows:35}
const defaults={command:'help',env:{TERM:'xterm-256color'},stdout:terminal,stdin:terminal}

test('intro stays silent for pipes, agent formats, host agents and worker daemons',async()=>{
  for(const patch of [
    {stdout:{isTTY:false}},{stdin:{isTTY:false}},{agentHost:true},{command:'agent'},
    {command:'worker',args:['run']},{command:'worker',args:['status']},
    ...['json','ndjson','agent','no-intro'].map(flag=>({flags:{[flag]:true}})),
    {env:{TERM:'dumb'}},{env:{CI:'true'}},{env:{INDIECORNS_NO_INTRO:'1'}},
  ]) {
    let writes=0
    const options={...defaults,...patch}
    options.stdout={...options.stdout,write(){writes++}}
    assert.equal(await showTerminalIntro(options),false,JSON.stringify(patch))
    assert.equal(writes,0)
  }
})

test('NO_COLOR including an empty value and reduced motion produce static intros',async()=>{
  for(const env of [{NO_COLOR:''},{NO_COLOR:'1'},{REDUCE_MOTION:'1'},{INDIECORNS_REDUCED_MOTION:'true'}]) {
    let output='',waits=0
    await showTerminalIntro({...defaults,env:{...defaults.env,...env},stdout:{...terminal,write:s=>output+=s},wait:async()=>waits++})
    assert.equal(waits,0)
    assert.match(output,/Indiecorns/)
    if(Object.hasOwn(env,'NO_COLOR'))assert.doesNotMatch(output,/\x1b/)
  }
})

test('animation is bounded to 160 ms, never hides cursor and supports skipping motion',async()=>{
  const waits=[],writes=[]
  await showTerminalIntro({...defaults,stdout:{...terminal,write:s=>writes.push(s)},wait:async ms=>waits.push(ms)})
  assert.deepEqual(waits,[80,80])
  assert.equal(writes.length,3)
  assert.doesNotMatch(writes.join(''),/\x1b\[\?25l/)
  assert.equal(introOptions({...defaults,flags:{'no-animation':true}}).animate,false)
  assert.equal(introOptions({...defaults,stdout:{...terminal,columns:40}}).compact,true)
  assert.ok(introFrame({color:true}).includes('38;2;154;239;252'))
})
