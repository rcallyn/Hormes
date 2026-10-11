import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Brain, BrainTask } from '@hormes/brain';
import type { WorkCommand, WorkReply } from '@hormes/protocol';
import { FakeHands, makeRunner, makeTask, makeSink } from '../../../brain/src/__tests__/fakes.ts';
import { AgentRegistry } from '@hormes/agents';
import { ComputerToolset, ConfirmationDesk, ConfirmationState, FocusLease, NativeRequestError } from '@hormes/hands';
import { LaneRunner } from '../threads/runner.ts';
import { WorkCoordinator } from '../work/coordinator.ts';
import { VC_DEMO_QUOTE, VC_DEMO_RECIPIENT } from '../work/meeting.ts';
class Gmail extends FakeHands {
 actions:string[]=[]; byteBound=true; changed=false; busyOnFill=false;
 override async request<T>(op:string,args:Record<string,unknown>={}):Promise<T>{
  if(op==='frontmost')return {app:'Google Chrome',pid:1} as T;
  if(op==='user_idle')return {foreignMs:100_000,idleMs:100_000} as T;
  if(op==='browser_tabs')return {tabs:[{url:'https://mail.google.com/mail/u/0/#inbox',windowId:10,tabId:11,index:1,active:true,title:'Synthetic Gmail'}]} as T;
  if(op==='browser_url'){assert.equal(args['windowId'],10);assert.equal(args['tabId'],11);return {url:'https://mail.google.com/mail/u/0/#inbox'} as T;}
  if(op==='browser_js'){
   const script=String(args['script']);assert.equal(args['tabId'],11);
   if(script.includes('entry.phase="send-requested"')){this.actions.push('send-check');if(this.changed)throw Error('Recipient, subject or body changed; review again');this.actions.push('SEND');return {result:JSON.stringify({sendRequested:true})} as T;}
   if(script.includes('state[id]={prior')){this.actions.push('compose');return {result:'{"opened":true}'} as T;}
   if(script.includes('transfer.items.add')){this.actions.push('fill');if(this.busyOnFill)throw new NativeRequestError({code:'busy',message:'User used the keyboard/mouse'});assert.ok(script.includes(VC_DEMO_RECIPIENT));assert.ok(script.includes('Hormes-deck-v1.pdf'));assert.ok(!script.includes('Hormes-retention-v1.xlsx'));return {result:'{"filled":true}'} as T;}
   if(script.includes('Another recipient is present'))return {result:'{"committed":true}'} as T;
   this.actions.push('inspect');return {result:JSON.stringify({verified:true,byteBoundAttachments:this.byteBound})} as T;
  }
  return super.request<T>(op);
 }
}
function fixture(t:{after(fn:()=>Promise<void>):void}){
 const dir=mkdtempSync(join(tmpdir(),'hormes-gmail-meeting-'));const hands=new Gmail(),replies:WorkReply[]=[];let work:WorkCoordinator;let approve:(request:{pendingId:string;description:string})=>Promise<{pendingId:string;approved:boolean}>=async r=>({...r,approved:true});let approvals=0;
 const confirmations=new ConfirmationState();const runner=new LaneRunner({stateDir:dir,agents:new AgentRegistry([]),toolset:new ComputerToolset({hands,confirmations}),lease:new FocusLease({hands}),lane:'screen',laneId:'synthetic-meeting-gmail',desk:new ConfirmationDesk(confirmations,()=>{}),work:{isActive:s=>work.isActive(s),model:(s,op,p)=>work.model(s,op,p),receipt:(s,n,a,text)=>work.receipt(s,n,a,text)}});
 const brain={handle:async()=>{throw Error('No model may receive Gmail capability or approval')},cancel:async()=>{},stop:async()=>{}} as unknown as Brain;
 work=new WorkCoordinator({stateDir:dir,redact:s=>s,emit:r=>replies.push(r),lane:()=>({brain,runner}),approveMeetingSend:async r=>{approvals++;hands.actions.push('owner-approval');assert.match(r.description,/JacobY@transposeplatform.vc/);assert.match(r.description,/Hormes-deck-v1.pdf/);return approve(r);}});
 const command=(c:Omit<WorkCommand,'requestId'>)=>work.command({...c,requestId:randomUUID()});
 work.store.command({action:'demo',blockId:'meeting',requestId:randomUUID()});work.store.command({action:'recap',text:VC_DEMO_QUOTE,requestId:randomUUID()});
 const m=work.store.state().active!.meeting!;work.store.model(work.store.scope()!,'meeting',{stage:'follow-up',subject:'Synthetic deck follow-up',body:'Here is the requested synthetic pitch deck.',requests:['Send pitch deck'],sourceIds:[m.sourceId],revision:m.revision,attachmentIds:['vc_deck']});
 const draft=work.store.state().active!.meeting!.followUp!, target={sessionId:work.store.scope()!.sessionId,planId:draft.id,revision:draft.revision};work.store.command({action:'meeting.review',requestId:randomUUID(),...target});
 t.after(async()=>{await work.stop();rmSync(dir,{recursive:true,force:true});});
 return {work,hands,runner,replies,command,target,approve:(fn:typeof approve)=>{approve=fn;},approvals:()=>approvals,run:()=>command({action:'meeting.gmail-draft',...target}),send:()=>command({action:'meeting.send',...target})};
}
test('real coordinator and runner prepare actual browser compose with only existing deck; explicit send authenticates then checks before one click',async t=>{
 const f=fixture(t);await f.run();assert.deepEqual(f.hands.actions,['compose','fill','inspect','inspect']);assert.equal(f.approvals(),0);assert.equal(f.work.store.state().active!.meeting!.followUp!.to,VC_DEMO_RECIPIENT);
 await f.send();assert.deepEqual(f.hands.actions,['compose','fill','inspect','inspect','inspect','inspect','owner-approval','send-check','SEND']);assert.equal(f.approvals(),1);assert.equal(f.work.store.state().active!.meeting!.followUp!.gmail!.status,'send-requested');
 await f.send();assert.equal(f.approvals(),1);assert.equal(f.hands.actions.filter(x=>x==='SEND').length,1);assert.equal(f.replies.at(-1)!.ok,false);
});
test('cancelled, wrong-identity and unavailable owner approval leave draft unsent',async t=>{
 for(const outcome of ['cancel','mismatch','unavailable']){
  const f=fixture(t);await f.run();f.approve(async r=>{if(outcome==='unavailable')throw Error('Touch ID unavailable');return {pendingId:outcome==='mismatch'?'model-forged':r.pendingId,approved:outcome!=='cancel'};});await f.send();assert.ok(!f.hands.actions.includes('SEND'));assert.equal(f.work.store.state().active!.meeting!.followUp!.gmail!.status,'draft-prepared');assert.equal(f.replies.at(-1)!.ok,false);
 }
});
test('meeting source, catalog bytes and actual Gmail edits during approval refuse send',async t=>{
 for(const edit of ['source','file','dom']){
  const f=fixture(t);await f.run();f.approve(async r=>{
   if(edit==='source')f.work.store.command({action:'recap',text:'Wait before sending.',requestId:randomUUID()});
   if(edit==='file'){const file=f.work.store.state().active!.meeting!.attachments[0]!;writeFileSync(file.path,Buffer.alloc(readFileSync(file.path).length));}
   if(edit==='dom')f.hands.changed=true;
   return {...r,approved:true};
  });await f.send();assert.ok(!f.hands.actions.includes('SEND'));assert.equal(f.replies.at(-1)!.ok,false);
 }
});
test('unverifiable attachment objects block before owner approval and repeated draft command only reinspects same compose',async t=>{
 const f=fixture(t);f.hands.byteBound=false;await f.run();await f.run();assert.equal(f.hands.actions.filter(a=>a==='compose').length,1);await f.send();assert.equal(f.approvals(),0);assert.ok(!f.hands.actions.includes('SEND'));
});
test('stale displayed draft and model-supplied Gmail arguments cannot acquire capability',async t=>{
 const f=fixture(t);await f.command({action:'meeting.gmail-draft',...f.target,planId:'stale'});assert.equal(f.hands.actions.length,0);
 const task:BrainTask={...makeTask('send email'),work:f.work.store.scope()!};f.runner.attach(makeSink().sink,task);const result=await f.runner.run('meeting_gmail',{operation:'send',ownerApproved:{approved:true},to:VC_DEMO_RECIPIENT});assert.equal(result.result.kind,'error');assert.equal(f.hands.actions.length,0);
});

test('real focus lease never retries a multi-step compose after native busy during filling',async t=>{
 const f=fixture(t);f.hands.busyOnFill=true;await f.run();assert.deepEqual(f.hands.actions,['compose','fill']);assert.equal(f.approvals(),0);assert.equal(f.replies.at(-1)!.ok,false);
});
