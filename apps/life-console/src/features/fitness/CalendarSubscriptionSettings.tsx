import {useEffect,useRef,useState} from 'react';
import type {FitnessSubscriptionPort,FitnessSubscriptionState} from '../../domain/fitness-subscription';
import {FitnessDialog} from './FitnessDialog';
export function CalendarSubscriptionSettings({repository,synthetic=false}:{repository:FitnessSubscriptionPort;synthetic?:boolean}){
 const [open,setOpen]=useState(false);
 return <><button className="secondary-button" onClick={()=>setOpen(true)}>Apple 日历订阅</button>{open&&<Settings repository={repository} synthetic={synthetic} onClose={()=>setOpen(false)}/>}</>;
}
function Settings({repository,onClose,synthetic=false}:{repository:FitnessSubscriptionPort;onClose():void;synthetic?:boolean}){
 const [state,setState]=useState<FitnessSubscriptionState|null>(null),[notes,setNotes]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false),[link,setLink]=useState(''),[confirmation,setConfirmation]=useState<'rotate'|'disable'|null>(null),[receipt,setReceipt]=useState('');
 const alive=useRef(true),lock=useRef(false),generation=useRef(0);
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;generation.current++;};},[repository]);
 async function refresh(){const id=++generation.current;setLoading(true);setError('');setLink('');try{const value=await repository.get();if(!alive.current||id!==generation.current)return;setState(value);setNotes(value.includeNotes);setUncertain(false);}catch{if(alive.current&&id===generation.current)setError('订阅状态读取失败，请重试。');}finally{if(alive.current&&id===generation.current)setLoading(false);}}
 async function save(action:'rotate'|'disable'|'preferences'){
  if(!state||lock.current||uncertain)return;lock.current=true;setBusy(true);setError('');setReceipt('');setLink('');setConfirmation(null);
  try{const input={expectedRevision:state.revision,includeNotes:notes};const value=action==='rotate'?await repository.rotate(input):await repository.update({...input,enabled:action==='disable'?false:state.enabled});if(!alive.current)return;setState(value);setNotes(value.includeNotes);if('url' in value)setLink(String(value.url));setReceipt(action==='disable'?'订阅已停用，旧链接已失效。':'订阅设置已保存。Apple 的刷新可能延迟。');}
  catch{if(alive.current){setUncertain(true);setError('未确认保存。可能发生网络中断或其他设备更新，请先刷新订阅状态；若链接未收到，请核对后更换链接。');}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <FitnessDialog label="Apple 日历订阅" busy={busy} onClose={onClose}>
  <div className="section-head"><h2>Apple 日历订阅</h2><button data-initial-focus className="secondary-button" disabled={busy} onClick={onClose}>关闭</button></div>
  {synthetic&&<p className="quiet">合成演示：此处链接不可订阅，不连接个人日历。</p>}
  <p>将健身事件、起止时间和地点提供给 Apple 日历。预约由 Life Console 维护，订阅端只读；刷新可能延迟。</p>
  <p className="quiet">持有私密链接的人可读取日历。不要公开或转发链接。停用不能删除 Apple 已缓存的副本。</p>
  {loading?<p>正在读取订阅状态…</p>:state&&<p role="status">{state.enabled?'已启用':'未启用'}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}{receipt&&<p role="status">{receipt}</p>}
  <label className="fitness-subscription-notes"><input type="checkbox" checked={notes} disabled={busy||loading||!state} onChange={e=>setNotes(e.target.checked)}/>包含备注</label>
  {link&&<div className="fitness-subscription-link"><label>私密订阅地址<input readOnly value={link} onFocus={e=>e.target.select()}/></label><p className="quiet">链接仅在此面板显示，关闭后不保留。请在 Apple 日历中选择“新建日历订阅”，粘贴此地址；需要多设备使用时选择 iCloud。</p><button className="secondary-button" onClick={()=>void navigator.clipboard.writeText(link).then(()=>{if(alive.current)setReceipt('链接已复制。');}).catch(()=>{if(alive.current)setError('复制失败，请选中地址手动复制。');})}>复制链接</button></div>}
  <div className="button-row">
   <button className="primary-button" disabled={!state||busy||loading||uncertain} onClick={()=>setConfirmation('rotate')}>{state?.enabled?'更换订阅链接':'启用订阅'}</button>
   {state?.enabled&&<><button className="secondary-button" disabled={busy||loading||uncertain||notes===state.includeNotes} onClick={()=>void save('preferences')}>保存备注设置</button><button className="secondary-button danger" disabled={busy||loading||uncertain} onClick={()=>setConfirmation('disable')}>停用订阅</button></>}
   <button className="secondary-button" disabled={busy||loading} onClick={()=>void refresh()}>刷新订阅状态</button>
  </div>
  {confirmation&&<div className="fitness-subscription-confirm"><p>{confirmation==='disable'?'停用后旧链接立即失效。你可在 Apple 日历取消订阅。':state?.enabled?'更换后旧链接立即失效，需要在 Apple 日历更新订阅地址。':`确认通过私密链接提供事件、时间、地点${notes?'和备注':''}？`}</p><div className="button-row"><button className="secondary-button" onClick={()=>setConfirmation(null)}>取消</button><button className="primary-button" onClick={()=>void save(confirmation)}>{confirmation==='disable'?'确认停用':state?.enabled?'确认更换':'确认启用'}</button></div></div>}
 </FitnessDialog>;
}
