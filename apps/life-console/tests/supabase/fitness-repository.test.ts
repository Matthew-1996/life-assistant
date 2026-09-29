// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { FitnessRepository } from "../../src/supabase/fitness";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const appointment={id,user_id:"11111111-1111-4111-8111-111111111111",title:"合成预约",start_at:"2030-05-01T10:00:00.123456+00:00",end_at:"2030-05-01T11:00:00Z",time_zone:"Asia/Shanghai",location:"",notes:"",revision:1,deleted_at:null,created_at:"2030-05-01T00:00:00Z",updated_at:"2030-05-01T00:00:00Z"};
const input={title:"合成预约",startAt:"2030-05-01T18:00:00+08:00",endAt:"2030-05-01T19:00:00+08:00"};
function client(responses: Array<{status:number;body:unknown}>) {
  const requests: Request[]=[];
  const db=createClient("https://synthetic.supabase.invalid","public-test-key",{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},
    global:{fetch:async (url,init)=>{requests.push(new Request(url,init));const r=responses.shift();if(!r)throw Error("Missing synthetic response");return new Response(JSON.stringify(r.body),{status:r.status,headers:{"content-type":"application/json"}})}}
  });
  return {repo:new FitnessRepository(db),requests};
}

describe("FitnessRepository",()=>{
  it("uses atomic create with caller key, optional defaults and no owner field",async()=>{
    const {repo,requests}=client([{status:200,body:[appointment]}]);
    expect(await repo.create({...input,title:"  合成预约  ",operationKey:"fitness-client-test-0001"})).toEqual(appointment);
    expect(new URL(requests[0].url).pathname).toBe("/rest/v1/rpc/create_fitness_appointment");
    expect(await requests[0].json()).toEqual({p_operation_key:"fitness-client-test-0001",p_title:"合成预约",p_start_at:input.startAt,p_end_at:input.endAt,p_location:"",p_notes:""});
  });
  it("preserves microsecond cursors and uses lookahead without dropping page 101",async()=>{
    const rows=Array.from({length:101},(_,i)=>({...appointment,id:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}`}));
    const {repo,requests}=client([{status:200,body:rows},{status:200,body:[rows[100]]}]);
    const first=await repo.listRange({from:"2030-05-01",to:"2030-06-01"});
    expect(first.items).toHaveLength(100);expect(first.nextCursor).toEqual({startAt:appointment.start_at,id:rows[99].id});
    const second=await repo.listRange({from:"2030-05-01",to:"2030-06-01",cursor:first.nextCursor!});
    expect(second.items).toEqual([rows[100]]);expect(second.nextCursor).toBeNull();
    expect(await requests[1].json()).toEqual({p_from:"2030-05-01",p_to:"2030-06-01",p_cursor_start:appointment.start_at,p_cursor_id:rows[99].id});
  });
  it("fetches deleted records for conflict handling and represents missing as null",async()=>{
    const deleted={...appointment,revision:2,deleted_at:"2030-05-01T11:00:00Z"};
    const {repo}=client([{status:200,body:[deleted]},{status:200,body:[]}]);
    expect(await repo.get(id)).toEqual(deleted);expect(await repo.get(id)).toBeNull();
  });
  it("uses revision-safe update and soft deletion",async()=>{
    const {repo,requests}=client([{status:200,body:[appointment]},{status:200,body:[appointment]}]);
    await repo.update({...input,id,expectedRevision:1});await repo.softDelete({id,expectedRevision:1});
    expect(await requests[0].json()).toMatchObject({p_id:id,p_expected_revision:1});
    expect(new URL(requests[1].url).pathname).toContain("soft_delete_fitness_appointment");
  });
  it.each([
    {title:"  "},{title:"x".repeat(121)},{location:"x".repeat(241)},{notes:"x".repeat(4001)},
    {startAt:"2030-05-01T18:00:00"},{startAt:"2030-02-30T10:00:00Z"},
    {endAt:"2030-05-01T09:00:00Z"},{endAt:"2030-05-01T16:00:00Z"},
  ])("rejects invalid fields before a network call: %j",async(patch)=>{
    const {repo,requests}=client([]);await expect(repo.create({...input,...patch,operationKey:"fitness-client-invalid"})).rejects.toMatchObject({kind:"validation"});expect(requests).toHaveLength(0);
  });
  it("validates UUIDs, revision, operation key and calendar range",async()=>{
    const {repo,requests}=client([]);
    await expect(repo.get("not-an-id")).rejects.toMatchObject({kind:"validation"});
    await expect(repo.softDelete({id,expectedRevision:0})).rejects.toMatchObject({kind:"validation"});
    await expect(repo.create({...input,operationKey:"short"})).rejects.toMatchObject({kind:"validation"});
    for(const [from,to] of [["2030-02-30","2030-03-01"],["2030-01-01","2030-04-01"],["2030-01-02","2030-01-01"]]) await expect(repo.listRange({from,to})).rejects.toMatchObject({kind:"validation"});
    expect(requests).toHaveLength(0);
  });
  it.each([[403,"42501","forbidden"],[409,"PT409","conflict"],[409,"40001","conflict"],[400,"22023","validation"],[404,"P0002","conflict"],[503,"PGRST000","transient"]])("maps write error %s/%s without retry",async(status,code,kind)=>{
    const {repo,requests}=client([{status:status as number,body:{code,message:"Synthetic error"}}]);
    await expect(repo.update({...input,id,expectedRevision:1})).rejects.toMatchObject({kind});expect(requests).toHaveLength(1);
  });
  it("throws on a failed read instead of returning an empty page",async()=>{
    const {repo}=client([{status:503,body:{code:"PGRST000",message:"Unavailable"}},{status:503,body:{code:"PGRST000",message:"Unavailable"}}]);
    await expect(repo.listRange({from:"2030-05-01",to:"2030-06-01"})).rejects.toMatchObject({kind:"transient"});
  });
  it("uses Shanghai IANA rules including historical daylight saving",async()=>{
    const {repo}=client([{status:200,body:[appointment]}]);
    await expect(repo.create({...input,startAt:"1990-06-01T15:30:00Z",endAt:"1990-06-01T16:30:00Z",operationKey:"fitness-historical-zone"})).resolves.toEqual(appointment);
  });
  it("rejects empty successful writes",async()=>{
    const {repo}=client([{status:200,body:[]}]);await expect(repo.create({...input,operationKey:"fitness-client-empty"})).rejects.toMatchObject({kind:"unknown"});
  });
});

it("accepts a Shanghai whole day and passes its explicit kind", async () => {
 const {repo,requests}=client([{status:200,body:[{...appointment,time_kind:"all_day"}]}]);
 await repo.create({...input,startAt:"2030-05-01T00:00:00+08:00",endAt:"2030-05-02T00:00:00+08:00",timeKind:"all_day",operationKey:"fitness-all-day-test"});
 expect(await requests[0].json()).toMatchObject({p_time_kind:"all_day"});
});
