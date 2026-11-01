import {chmodSync} from 'node:fs'
import {join} from 'node:path'

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
  let database
  try {
    const path=join(directory,'worker-guard.sqlite')
    database=new DatabaseSync(path,{timeout:0})
    chmodSync(path,0o600)
    database.exec('CREATE TABLE IF NOT EXISTS worker_guard (id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE')
  } catch(error) {
    database?.close()
    if([5,6].includes(error.errcode&255)) throw new Error('Worker already running')
    throw error
  }
  return ()=>database.close()
}
