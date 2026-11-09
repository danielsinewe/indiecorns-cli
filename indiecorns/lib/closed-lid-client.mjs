import * as fs from 'node:fs'
import {join,isAbsolute,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {setTimeout as sleep} from 'node:timers/promises'
import {rootDirectory,rootLabel,validatePowerRequest,parseSleepDisabled} from './closed-lid-helper.mjs'

const quote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'"
const xml=value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))
const digest=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const safeFile=(path,uid,{write=false,maxSize=16384}={})=>{
  const fd=fs.openSync(path,(write?fs.constants.O_WRONLY:fs.constants.O_RDONLY)|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK)
  try {
    const info=fs.fstatSync(fd)
    if(!info.isFile()||info.uid!==uid||info.nlink!==1||(info.mode&0o022)!==0||info.size>maxSize)throw new Error('Unsafe power helper file')
    return fd
  }catch(e){fs.closeSync(fd);throw e}
}
export function closedLidStatus({directory=rootDirectory,rootUid=0,now=Date.now()}={}) {
  let fd
  try {
    fd=safeFile(join(directory,'status.json'),rootUid)
    const value=JSON.parse(fs.readFileSync(fd,'utf8'))
    if(value.version!==1||!Number.isSafeInteger(value.at)||!['disabled','active','restore_failed'].includes(value.state))throw new Error('Invalid helper status')
    return {...value,installed:true,state:now-value.at>10000||value.at>now+5000?'helper_unavailable':value.state,
      closedLidVerified:false,evidence:'Local helper receipt; no hardware or successful browser-discovery claim.'}
  }catch(error){if(error.code==='ENOENT')return {version:1,state:'helper_not_installed',installed:false,requiresAdmin:true,closedLidVerified:false};throw error}
  finally{if(fd!==undefined)fs.closeSync(fd)}
}
export function inspectClosedLidStatus(options={}) {
  const helper=closedLidStatus(options)
  const run=options.run??((command,args)=>spawnSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:16384,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}}))
  let systemSleepDisabled=null
  try {const result=run('/usr/bin/pmset',['-g']);if(result.status===0&&!result.error)systemSleepDisabled=parseSleepDisabled(result.stdout??'')}catch{}
  return {...helper,systemSleepDisabled,settingAttribution:systemSleepDisabled===1?(helper.state==='active'?'helper_lease_reported':'unattributed'):'none_or_unknown'}
}
export async function requestClosedLid(op,{minutes=60,pid,startedAt,acceptSystemWide=false,directory=rootDirectory,uid=process.getuid?.(),rootUid=0,now=Date.now,wait=sleep}={}) {
  const request={version:1,op,nonce:randomUUID(),at:now(),...(op==='enable'?{minutes,pid,startedAt,acceptSystemWide}:{})}
  validatePowerRequest(request,request.at)
  const fd=safeFile(join(directory,'request.json'),uid,{write:true,maxSize:2048})
  try {fs.ftruncateSync(fd,0);fs.writeFileSync(fd,JSON.stringify(request)+'\n');fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  // A request is not an acknowledged effect. Stop after five seconds; callers
  // can inspect the same nonce receipt instead of replaying uncertain enables.
  for(let attempt=0;attempt<10;attempt++) {
    await wait(500)
    const result=closedLidStatus({directory,rootUid,now:now()})
    if(result.requestError?.nonce===request.nonce)return {...result,acknowledged:true,accepted:false,requestNonce:request.nonce}
    if(result.lastNonce===request.nonce)return {...result,acknowledged:true,accepted:true,requestNonce:request.nonce}
  }
  return {version:1,state:'acknowledgement_pending',acknowledged:false,requestNonce:request.nonce,
    nextCommand:'indiecorns worker power status --mode closed-lid',closedLidVerified:false}
}

export function helperLaunchDaemon() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${rootLabel}</string>
<key>ProgramArguments</key><array>${[join(rootDirectory,'node'),'--disable-proto=throw','--no-warnings',join(rootDirectory,'helper.mjs'),'--serve'].map(s=>'<string>'+xml(s)+'</string>').join('')}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>5</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin</string><key>LC_ALL</key><string>C</string></dict>
<key>StandardOutPath</key><string>/dev/null</string><key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`
}

export function verifyRootRuntime(node,{inspect=(path)=>spawnSync('/usr/bin/otool',['-L',path],{encoding:'utf8',timeout:5000,maxBuffer:16384})}={}) {
  const result=inspect(node)
  const dependencies=(result.stdout??'').split('\n').slice(1).map(s=>s.trim()).filter(Boolean).map(s=>s.split(' (')[0])
  if(result.error||result.status!==0||dependencies.length===0||dependencies.some(s=>!s.startsWith('/usr/lib/')&&!s.startsWith('/System/Library/')))
    throw new Error('Privileged helper requires a standalone Node runtime linked only to macOS system libraries')
  return dependencies
}

// Produces a reviewable, inert package. Neither builder nor CLI ever invokes
// sudo, launchctl, pmset writes or the privileged entry point automatically.
export function buildClosedLidPackage({output,node,cli,uid=process.getuid?.(),system=process.platform,inspectRuntime}={}) {
  if(system!=='darwin')throw new Error('Closed-lid packaging supports macOS only')
  if(!Number.isInteger(uid)||uid<=0||![output,node,cli].every(s=>typeof s==='string'&&isAbsolute(s)&&!/[\r\n\0]/.test(s)))throw new Error('Invalid helper package binding')
  output=resolve(output)
  const nodeSource=fs.realpathSync(node),nodeHash=digest(nodeSource)
  const dependencies=verifyRootRuntime(nodeSource,{inspect:inspectRuntime})
  if(digest(nodeSource)!==nodeHash)throw new Error('Node runtime changed during inspection')
  // Refuse existing folders; do not replace arbitrary user files or packages.
  fs.mkdirSync(output,{mode:0o700})
  const source=fileURLToPath(new URL('./closed-lid-helper.mjs',import.meta.url))
  const helper=fs.readFileSync(source,'utf8'),helperHash=createHash('sha256').update(helper).digest('hex')
  const config=JSON.stringify({version:1,uid,node,cli})+'\n'
  const configHash=createHash('sha256').update(config).digest('hex')
  const daemon=helperLaunchDaemon(),daemonHash=createHash('sha256').update(daemon).digest('hex')
  const install=`#!/bin/sh
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
unset NODE_OPTIONS NODE_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
[ "$(/usr/bin/uname -s)" = Darwin ] || exit 1
[ "$(/usr/bin/id -u)" -eq 0 ] || { echo 'Run this reviewed installer with sudo.' >&2; exit 1; }
[ "\u0024{SUDO_UID:-}" = '${uid}' ] || { echo 'Installer must be authorized by its bound member.' >&2; exit 1; }
cd -- "$(/usr/bin/dirname -- "$0")"
verify() { [ "$(/usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}')" = "$2" ]; }
verify ${quote(nodeSource)} '${nodeHash}'
verify helper.mjs '${helperHash}'
verify config.json '${configHash}'
verify daemon.plist '${daemonHash}'
for parent in /Library /Library/LaunchDaemons /Library/Indiecorns; do
  if [ -e "$parent" ]; then
    [ ! -L "$parent" ] && [ -d "$parent" ] && [ "$(/usr/bin/stat -f %u "$parent")" -eq 0 ] || exit 1
    mode=$(/usr/bin/stat -f %Lp "$parent")
    [ $((0$mode & 022)) -eq 0 ] || exit 1
  fi
done
[ ! -e '${rootDirectory}' ] && [ ! -L '${rootDirectory}' ] || { echo 'Existing helper preserved. Uninstall before replacement.' >&2; exit 1; }
[ ! -e '/Library/LaunchDaemons/${rootLabel}.plist' ] && [ ! -L '/Library/LaunchDaemons/${rootLabel}.plist' ] || exit 1
/bin/mkdir -p /Library/Indiecorns
/bin/mkdir -m 700 '${rootDirectory}'
/usr/bin/install -o root -g wheel -m 755 ${quote(nodeSource)} '${rootDirectory}/node'
/usr/bin/install -o root -g wheel -m 644 helper.mjs '${rootDirectory}/helper.mjs'
/usr/bin/install -o root -g wheel -m 600 config.json '${rootDirectory}/config.json'
verify '${rootDirectory}/node' '${nodeHash}'
verify '${rootDirectory}/helper.mjs' '${helperHash}'
verify '${rootDirectory}/config.json' '${configHash}'
printf 'null\\n' > '${rootDirectory}/request.json'
/usr/sbin/chown '${uid}' '${rootDirectory}/request.json'
/bin/chmod 600 '${rootDirectory}/request.json'
/bin/chmod 755 '${rootDirectory}'
/usr/bin/install -o root -g wheel -m 644 daemon.plist '/Library/LaunchDaemons/${rootLabel}.plist'
verify '/Library/LaunchDaemons/${rootLabel}.plist' '${daemonHash}'
/bin/launchctl bootstrap system '/Library/LaunchDaemons/${rootLabel}.plist'
echo 'Helper installed, sleep prevention remains disabled. Enable a bounded session through the unprivileged CLI.'
`
  const uninstall=`#!/bin/sh
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
unset NODE_OPTIONS NODE_PATH DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH
[ "$(/usr/bin/id -u)" -eq 0 ] || exit 1
[ "\u0024{SUDO_UID:-}" = '${uid}' ] || exit 1
# Stop the watchdog. The kernel lock prevents restore/uninstall overlapping it.
/bin/launchctl bootout 'system/${rootLabel}' 2>/dev/null || true
'${rootDirectory}/node' --disable-proto=throw --no-warnings '${rootDirectory}/helper.mjs' --uninstall
# A failed or unknown restore above stops removal and retains the journal.
/bin/rm -f '/Library/LaunchDaemons/${rootLabel}.plist'
for name in helper.mjs node config.json request.json status.json journal.json guard.sqlite guard.sqlite-journal; do
  /bin/rm -f '${rootDirectory}/'"$name"
done
/bin/rmdir '${rootDirectory}'
echo 'Sleep state restored or an external change preserved. Helper removed.'
`
  for(const [name,text,mode] of [['helper.mjs',helper,0o600],['config.json',config,0o600],['daemon.plist',daemon,0o600],['install.sh',install,0o700],['uninstall.sh',uninstall,0o700]])fs.writeFileSync(join(output,name),text,{mode,flag:'wx'})
  const result={version:1,state:'package_prepared',installed:false,activated:false,requiresAdmin:true,
    output,nodeSha256:nodeHash,nodeSystemLibraries:dependencies,helperSha256:helperHash,workerUid:uid,
    installCommand:'/usr/bin/sudo /bin/sh '+quote(join(output,'install.sh')),
    uninstallCommand:'/usr/bin/sudo /bin/sh '+quote(join(output,'uninstall.sh')),
    limitations:['Administrator installation is separate from explicit enable.','AC only; 1–120 minutes; ventilated surface required.',
      'Closed-lid operation and thermal behavior require a separate hardware test.','Same-value power changes by other software cannot be attributed.','This does not keep ChatGPT browser RPC alive.']}
  fs.writeFileSync(join(output,'manifest.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'})
  return result
}
