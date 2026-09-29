import type {FitnessSubscriptionPort,FitnessSubscriptionState} from '../domain/fitness-subscription';
interface Dependencies {origin:string;getAccessToken():Promise<string|null>;fetch:typeof globalThis.fetch}
export function createFitnessSubscriptionClient(deps:Dependencies):FitnessSubscriptionPort{
 const origin=new URL(deps.origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Invalid subscription origin');
 async function request(body?:Record<string,unknown>):Promise<FitnessSubscriptionState & {url?:string}>{
  const token=await deps.getAccessToken();if(!token)throw Error('Authentication required');
  const response=await deps.fetch(`${origin.origin}/calendar/subscription`,{method:body?'POST':'GET',cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error(`Subscription request failed (${response.status})`);
  const value=await response.json();if(!value||typeof value.enabled!=='boolean'||typeof value.includeNotes!=='boolean'||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Invalid subscription response');
  const state={enabled:value.enabled,includeNotes:value.includeNotes,revision:value.revision};
  if(body?.action==='rotate'){
   if(typeof value.url!=='string')throw Error('Missing private link');const url=new URL(value.url);
   if(url.origin!==origin.origin||url.username||url.password||url.hash||url.search||!/^\/calendar\/fitness\/[A-Za-z0-9_-]{43}\.ics$/.test(url.pathname))throw Error('Invalid private link');
   return {...state,url:url.href};
  }
  return state;
 }
 return {get:()=>request(),rotate:async input=>{const value=await request({action:'rotate',...input});if(!value.url)throw Error('Missing private link');return {...value,url:value.url};},update:input=>request({action:'update',...input})};
}
