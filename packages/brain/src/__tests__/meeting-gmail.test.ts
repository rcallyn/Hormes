import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { gmailCheckScript, gmailOpenScript, gmailDraftFingerprint, gmailApprovalFingerprint, runMeetingGmail, type GmailDraftInput, type GmailDraftBinding } from '../meeting-gmail.ts';
import { FakeHands } from './fakes.ts';
const bytes = Buffer.from('synthetic pitch deck fixture');
const input: GmailDraftInput = {to:'JacobY@transposeplatform.vc',subject:'Synthetic pitch deck',body:'The synthetic demo deck is attached.',files:[{name:'demo.pdf',mimeType:'application/pdf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')}]};
const binding: GmailDraftBinding = {app:'Google Chrome',windowId:10,tabId:11,composeId:'synthetic-compose',fingerprint:gmailDraftFingerprint(input),verifiedAt:100};
function dom() {
 let clicks=0;
 const file={name:'demo.pdf',size:bytes.length};
 const upload={isConnected:true,files:[file]};
 const subject={value:input.subject},body={innerText:input.body,querySelector:()=>null};
 const emails:any[]=[];const box={querySelectorAll:()=>emails};const to={value:'',closest:()=>box};const chip=(email:string)=>({getAttribute:()=>email,getBoundingClientRect:()=>({width:100,height:20}),closest:(q:string)=>q.includes('listbox')?box:{}});emails.push(chip(input.to));
 const link={href:'https://mail.google.com/mail/u/0/?view=att&realattid=synthetic',querySelector:()=>({textContent:'demo.pdf'}),textContent:'demo.pdf'};
 const links=[link];const summary:any[]=[];
 const buttons=[{innerText:'Send',getAttribute:()=> 'Send \u202a(⌘Enter)\u202c',getBoundingClientRect:()=>({width:20,height:20}),click:()=>clicks++}];
 const dialog={isConnected:true,innerText:'demo.pdf',querySelector:(q:string)=>q==='input[aria-label="To recipients"]'?to:q.includes('subjectbox')?subject:q.includes('contenteditable')?body:null,querySelectorAll:(q:string)=>q.startsWith('.oL.aDm')?summary:q==='a[href]'?links:q.includes('[email]')?emails:q.includes('input[type="file"]')?[upload]:q.includes('[role="button"]')?buttons:[]};
 const entry={phase:'filled',dialog,upload,files:[file],fingerprint:binding.fingerprint};
 const run=(send=false)=>JSON.parse(runInNewContext(gmailCheckScript(binding,input,send),{URL,location:{origin:'https://mail.google.com'},window:{__hormesMeetingDrafts:{[binding.composeId]:entry}},document:{querySelectorAll:()=>[]}}));
 return {run,clicks:()=>clicks,subject,body,emails,upload,buttons,dialog,entry,links,chip,summary};
}
test('actual browser send script reads exact reviewed fields and immutable File bytes before one Send click',()=>{
 const f=dom();assert.equal(f.run().byteBoundAttachments,true);assert.equal(f.clicks(),0);
 assert.equal(f.run(true).sendRequested,true);assert.equal(f.clicks(),1);
 assert.throws(()=>f.run(true),/closed or unavailable/);assert.equal(f.clicks(),1);
});
test('actual send script refuses body, recipient, attachment and Send-later substitutions',()=>{
 for(const mutate of [(f:ReturnType<typeof dom>)=>{f.subject.value='edited'},(f:ReturnType<typeof dom>)=>{f.body.innerText='edited'},(f:ReturnType<typeof dom>)=>{f.emails.push(f.chip('other@example.test'))},(f:ReturnType<typeof dom>)=>{f.entry.files=[]},(f:ReturnType<typeof dom>)=>{f.buttons[0]!.getAttribute=()=> 'Send later'}]) {
  const f=dom();mutate(f);assert.throws(()=>f.run(true));assert.equal(f.clicks(),0);
 }
});
test('Gmail replacing the upload input preserves immutable upload evidence but attachment replacement fails',()=>{
 const f=dom();f.upload.files=[];f.upload.isConnected=false;assert.equal(f.run().attachmentProof,'upload-bound');
 f.links[0]={...f.links[0]!};assert.throws(()=>f.run(true),/identity changed/);assert.equal(f.clicks(),0);
});
test('an app-owned partial compose is recovered by fingerprint without clicking Compose again',()=>{
 let clicks=0;const previous={fingerprint:binding.fingerprint,phase:'filled',dialog:{isConnected:true}};
 const result=JSON.parse(runInNewContext(gmailOpenScript('new-id',binding.fingerprint),{URL,location:{origin:'https://mail.google.com'},window:{__hormesMeetingDrafts:{[binding.composeId]:previous}},document:{querySelectorAll:()=>[{innerText:'Compose',click:()=>clicks++,getBoundingClientRect:()=>({width:20,height:20})}]}}));
 assert.equal(result.resumeComposeId,binding.composeId);assert.equal(clicks,0);
 previous.dialog.isConnected=false;assert.throws(()=>runInNewContext(gmailOpenScript('other-id',binding.fingerprint),{URL,location:{origin:'https://mail.google.com'},window:{__hormesMeetingDrafts:{[binding.composeId]:previous}},document:{querySelectorAll:()=>[]}}),/previous app draft was closed/);
});
class Browser extends FakeHands {
 calls:{op:string,args:Record<string,unknown>}[]=[];url='https://mail.google.com/mail/u/0/#inbox';tabs=1;
 override async request<T>(op:string,args:Record<string,unknown>={}):Promise<T>{
  this.calls.push({op,args});if(op==='browser_tabs')return {tabs:Array.from({length:this.tabs},()=>({url:this.url,windowId:10,tabId:11,index:1,active:true,title:'Synthetic Gmail'}))} as T;
  if(op==='browser_url')return {url:this.url} as T;
  if(op==='browser_js')return {result:JSON.stringify({sendRequested:true,verified:true,byteBoundAttachments:true})} as T;
  return super.request<T>(op);
 }
}
test('missing, expired, content-only and other-tab approval proofs cannot touch Gmail',async()=>{
 for(const proof of [undefined,{pendingId:'x',fingerprint:binding.fingerprint,at:100},{pendingId:'x',fingerprint:gmailApprovalFingerprint(input,{...binding,tabId:12}),at:100},{pendingId:'x',fingerprint:gmailApprovalFingerprint(input,binding),at:-40000}]){
  const hands=new Browser();await assert.rejects(()=>runMeetingGmail({operation:'send',input,binding,...(proof?{ownerApproved:proof}:{})},{hands,active:()=>true,now:()=>100}),/owner approval/);assert.equal(hands.calls.length,0);
 }
});
test('authenticated action stays on exact tab and fails before click after navigation or cancellation',async()=>{
 const hands=new Browser();hands.url='https://example.test';await assert.rejects(()=>runMeetingGmail({operation:'send',input,binding,ownerApproved:{pendingId:'x',fingerprint:gmailApprovalFingerprint(input,binding),at:100}},{hands,active:()=>true,now:()=>100}),/no longer Gmail/);assert.equal(hands.calls.length,1);assert.equal(hands.calls[0]!.args['tabId'],11);
 await assert.rejects(()=>runMeetingGmail({operation:'inspect',input,binding},{hands,active:()=>false}),/cancelled/);assert.equal(hands.calls.length,1);
});
test('mismatched catalog bytes and ambiguous Gmail accounts fail before compose',async()=>{
 const hands=new Browser();await assert.rejects(()=>runMeetingGmail({operation:'draft',input:{...input,files:[{...input.files[0]!,base64:Buffer.from('different').toString('base64')}]}},{hands,active:()=>true}),/Attachment bytes/);assert.equal(hands.calls.length,0);
 hands.tabs=2;await assert.rejects(()=>runMeetingGmail({operation:'draft',input},{hands,active:()=>true}),/exactly one/);assert.equal(hands.calls.length,1);
});

test('hidden autocomplete candidate cannot establish a committed visible recipient',()=>{
 const f=dom();f.emails[0]!.getBoundingClientRect=()=>({width:0,height:0});assert.throws(()=>f.run(),/Recipient/);assert.equal(f.clicks(),0);
});

test('hidden committed To chips require the exact visible collapsed recipient summary',()=>{
 const f=dom();f.emails[0].getBoundingClientRect=()=>({width:0,height:0});assert.throws(()=>f.run(),/Recipient/);
 f.summary.push(f.chip(input.to));assert.equal(f.run().verified,true);
 f.summary[0]=f.chip('other@example.test');assert.throws(()=>f.run(true),/Recipient/);assert.equal(f.clicks(),0);
});
