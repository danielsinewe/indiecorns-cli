// The website binds setup to its signed-in account; the server authenticates
// the Terminal identity. Neither cached names nor GitHub logins prove equality.
export const validAccountId = value => typeof value === 'string' && /^user_[A-Za-z0-9]{1,100}$/.test(value)
export function completedAccountMatches(session, expectedAccountId) {
  return !expectedAccountId || (validAccountId(expectedAccountId) && session?.userId === expectedAccountId)
}
export async function checkAccountHandoff({appUrl,headers,expectedAccountId,request=fetch}) {
  if(!expectedAccountId)return {state:'unbound'}
  if(!validAccountId(expectedAccountId))throw new Error('--account requires the account-bound command from https://app.indiecorns.com/join')
  if(!headers)return {state:'authorization_required'}
  try {
    const response=await request(`${appUrl}/api/community/worker-account`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(10000)})
    if(response.status===401||response.status===403){await response.body?.cancel();return {state:'authorization_required'}}
    if(!response.ok){await response.body?.cancel();return {state:'service_unavailable',httpStatus:response.status}}
    let text='',bytes=0
    for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>4096)throw new Error('Account response too large');text+=new TextDecoder().decode(chunk)}
    const body=JSON.parse(text)
    if(!validAccountId(body.userId))throw new Error('Invalid account response')
    return {state:body.userId===expectedAccountId?'matched':'account_mismatch'}
  }catch{return {state:'service_unavailable'}}
}
