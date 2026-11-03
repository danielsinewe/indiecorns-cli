const networkCodes=new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'])
const stages=new Set(['request','body','contract','checkpoint'])
const kinds=new Set(['transport','timeout','invalid_response','authentication','rate_limited','server','storage','unknown'])
// Whitelist diagnostic values. Error messages, causes, URLs, headers and bodies
// can contain credentials or private content and never enter persisted state.
export function discoveryError(error,stage='request',source) {
  const code=[error,error?.cause,error?.cause?.cause,...(Array.isArray(error?.cause?.errors)?error.cause.errors.slice(0,8):[])].map(e=>e?.code).find(code=>networkCodes.has(code))
  const kind=error?.code==='AUTH_REQUIRED'?'authentication':error?.code==='STORAGE_CAPACITY'?'storage':
    error?.name==='TimeoutError'||code?.includes('TIMEOUT')||code==='ETIMEDOUT'?'timeout':code||stage==='request'&&error?.name==='TypeError'?'transport':
    stage==='body'||stage==='contract'?'invalid_response':'unknown'
  return {kind,stage:stages.has(stage)?stage:'request',...(code?{code}:{}),
    ...(typeof source==='string'&&/^(peerlist|x|linkedin|producthunt)\/(follow|like|reshare|comment|upvote|rate)\/(profiles|posts|projects)$/.test(source)?{source}:{})}
}
export function safeDiscoveryError(error) {
  const candidate=error?.discoveryError
  if(!candidate||!kinds.has(candidate.kind)||!stages.has(candidate.stage))return discoveryError(error)
  return {...discoveryError(error,candidate.stage,candidate.source),kind:candidate.kind,
    ...(networkCodes.has(candidate.code)?{code:candidate.code}:{})}
}
