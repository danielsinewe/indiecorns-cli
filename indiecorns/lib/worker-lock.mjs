import {chmodSync} from 'node:fs'
import {join} from 'node:path'
import {randomInt} from 'node:crypto'
import {performance} from 'node:perf_hooks'
import {setTimeout as sleep} from 'node:timers/promises'

export function assertWorkerRuntime(version=process.versions.node) {
  const [major,minor]=version.split('.').map(Number)
  if(!(major>=24 || major===22 && minor>=22))
    throw new Error('Background workers require Node.js 22.22 LTS or Node.js 24+. Upgrade Node before installing the worker.')
}

// Hold a kernel-backed exclusive transaction for the process lifetime. Never
// unlink this database: a PID file alone cannot safely arbitrate stale recovery.
// SQLite releases ownership if the process is forcibly terminated.
export async function acquireWorkerGuard(directory) {
  assertWorkerRuntime()
  let DatabaseSync
  try {({DatabaseSync}=await import('node:sqlite'))}
  catch {throw new Error('This Node.js build lacks SQLite support required for background worker ownership')}
  const deadline=performance.now()+2000
  while(true) {
    let database
    try {
      const path=join(directory,'worker-guard.sqlite')
      database=new DatabaseSync(path,{timeout:0})
      chmodSync(path,0o600)
      database.exec('CREATE TABLE IF NOT EXISTS worker_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE')
      return ()=>database.close()
    } catch(error) {
      database?.close()
      if(![5,6].includes(error.errcode&255))throw error
      // Concurrent schema initialization can briefly reject every connection.
      // Close before retrying so contenders cannot hold a read-lock stalemate.
      if(performance.now()>=deadline)throw new Error('Worker already running')
      await sleep(randomInt(5,41))
    }
  }
}
