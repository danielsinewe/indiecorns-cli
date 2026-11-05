import {safeDiscoveryError} from './discovery-errors.mjs'

// Lost macOS resolver service during a network transition returns ENOTFOUND.
// Recheck a failed read after one minute; do not turn a local network failure
// into an extra five-minute outage. Explicit server/provider cooldowns win.
export function sourceRetryDelay(error, fallback=300000) {
  if(Number.isFinite(error?.retryAfterMs)&&error.retryAfterMs>0)return Math.max(60000,error.retryAfterMs)
  const failure=safeDiscoveryError(error)
  return failure.kind==='transport'&&['ENOTFOUND','EAI_AGAIN'].includes(failure.code)?60000:fallback
}
