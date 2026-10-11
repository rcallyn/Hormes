import { createHash, randomUUID } from "node:crypto";
import { classifyAction, type ActionContext, type Decision } from "@hormes/core";
import type { BrowserTab, NativeHands } from "@hormes/hands";

export interface GmailDraftFile { name: string; mimeType: string; bytes: number; sha256: string; base64: string }
export interface GmailDraftInput { to: string; subject: string; body: string; files: GmailDraftFile[] }
export interface GmailDraftBinding { app: string; windowId: number; tabId: number; composeId: string; fingerprint: string; verifiedAt: number }
export interface GmailDraftTask { operation: "draft" | "inspect" | "send"; input: GmailDraftInput; binding?: GmailDraftBinding; ownerApproved?: { pendingId: string; fingerprint: string; at: number } }
type Options = { hands: NativeHands; active(): boolean; policy?: (context: ActionContext) => Decision; now?: () => number; sleep?: (ms: number) => Promise<void> };
const APP = "Google Chrome";
const allowed = (url: string) => { try { return new URL(url).origin === "https://mail.google.com"; } catch { return false; } };
export function gmailDraftFingerprint(input: GmailDraftInput): string {
  return createHash("sha256").update(JSON.stringify({ to: input.to, subject: input.subject, body: input.body, files: input.files.map(({ base64: _, ...file }) => file) })).digest("hex");
}
export function gmailApprovalFingerprint(input: GmailDraftInput, binding: GmailDraftBinding): string {
  return createHash("sha256").update(JSON.stringify({ content: gmailDraftFingerprint(input), app: binding.app, windowId: binding.windowId, tabId: binding.tabId, composeId: binding.composeId })).digest("hex");
}
function validate(input: GmailDraftInput): void {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(input.to) || /[\r\n]/.test(input.subject) || !input.subject.trim() || !input.body.trim()) throw Error("The reviewed recipient, subject and body are required.");
  if (!input.files.length || input.files.length > 8 || input.files.some(file => !/^[\w .()-]+$/.test(file.name) || file.bytes > 10_000_000 || Buffer.from(file.base64, "base64").length !== file.bytes || createHash("sha256").update(Buffer.from(file.base64, "base64")).digest("hex") !== file.sha256)) throw Error("Attachment bytes do not match the reviewed catalog.");
}
const COMMON = `
if (location.origin !== "https://mail.google.com") throw Error("The bound tab is no longer Gmail");
const all = () => Array.from(document.querySelectorAll('[role="dialog"]')).filter(d => d.querySelector('input[name="subjectbox"]'));
const norm = s => String(s || "").replace(/[\\u202a-\\u202e\\u2066-\\u2069]/g, "").replace(/\\r/g, "").trim();
const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const state = window.__hormesMeetingDrafts || (window.__hormesMeetingDrafts = Object.create(null));
const recipientState = d => {
  const groups = ["To","Cc","Bcc"].map(kind => {
    const input=d.querySelector('input[aria-label="'+kind+' recipients"]');
    const box=input?.closest('[role="listbox"]');
    const chips=box ? Array.from(box.querySelectorAll('[data-hovercard-id],[email]')).filter(node=>node.closest('[role="listbox"]')===box && !!node.closest('[role="option"]')) : [];
    return {kind,input,box,chips,emails:[...new Set(chips.map(node=>node.getAttribute("email")||node.getAttribute("data-hovercard-id")).filter(Boolean).map(s=>s.toLowerCase()))],pending:norm(input?.value)};
  });
  return {to:groups[0],extra:groups.slice(1).some(g=>g.emails.length||g.pending)};
};
const visibleRecipient = (d,to) => {
  if(to.chips.some(visible)) return true;
  const summary=[...new Set(Array.from(d.querySelectorAll('.oL.aDm [email],.oL.aDm [data-hovercard-id]')).filter(visible).map(node=>node.getAttribute("email")||node.getAttribute("data-hovercard-id")).filter(Boolean).map(s=>s.toLowerCase()))];
  return to.emails.length===1 && summary.length===1 && summary[0]===to.emails[0];
};
`;
export function gmailOpenScript(composeId: string, fingerprint = ""): string {
  return `(() => { ${COMMON} const id=${JSON.stringify(composeId)},fingerprint=${JSON.stringify(fingerprint)}; const previous=Object.entries(state).filter(([key,e])=>e.fingerprint===fingerprint&&["opening","filled"].includes(e.phase)); if(previous.length>1) throw Error("Multiple prior app drafts match; review them in Gmail before retrying"); if(previous.length===1){ const [key,e]=previous[0]; if(e.phase==="filled"&&!e.dialog?.isConnected) throw Error("The previous app draft was closed; reopen it or regenerate the reviewed draft before retrying"); return JSON.stringify({resumeComposeId:key,phase:e.phase}); } if(state[id]) throw Error("Compose identity already exists"); const prior=all(); const buttons=Array.from(document.querySelectorAll('[gh="cm"],[role="button"],button')).filter(e=>visible(e)&&norm(e.innerText)==="Compose"); if(buttons.length!==1) throw Error("Open a signed-in English Gmail inbox with one Compose control"); state[id]={prior,phase:"opening",fingerprint}; buttons[0].click(); return JSON.stringify({opened:true}); })()`;
}
export function gmailFillScript(composeId: string, input: GmailDraftInput): string {
  return `(() => { ${COMMON} const id=${JSON.stringify(composeId)}, payload=${JSON.stringify(input)}, entry=state[id]; if(!entry || entry.phase!=="opening") throw Error("Compose preparation expired"); const fresh=all().filter(d=>!entry.prior.includes(d)); if(fresh.length!==1) return JSON.stringify({waiting:true}); const d=fresh[0], subject=d.querySelector('input[name="subjectbox"]'), body=d.querySelector('[contenteditable="true"][role="textbox"]'), to=d.querySelector('input[name="to"],input[aria-label="To recipients"],input[peoplekit-id]'), upload=d.querySelector('input[type="file"]'); if(!subject || !body || !to || !upload) throw Error("Gmail compose recipient/body/file controls are unavailable; no existing draft was changed"); if(norm(subject.value)||norm(body.innerText)||norm(to.value)) throw Error("New compose is not empty"); const put=(el,value)=>{ const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(el,value); el.dispatchEvent(new Event("input",{bubbles:true})); el.dispatchEvent(new Event("change",{bubbles:true})); }; put(subject,payload.subject); body.innerText=payload.body; body.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:payload.body})); const transfer=new DataTransfer(); for(const f of payload.files){const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0)); transfer.items.add(new File([bytes],f.name,{type:f.mimeType}));} upload.files=transfer.files; entry.dialog=d; entry.upload=upload; entry.files=Array.from(upload.files); entry.fingerprint=${JSON.stringify(gmailDraftFingerprint(input))}; entry.phase="filled"; upload.dispatchEvent(new Event("change",{bubbles:true})); return JSON.stringify({filled:true}); })()`;
}
/** Recipient input is asynchronous in Gmail; separate DOM turns prevent Enter from
 * racing the field update. Only this compose and the exact reviewed address are used. */
export function gmailRecipientScript(binding: GmailDraftBinding, input: GmailDraftInput, phase: "type" | "commit"): string {
  return `(() => { ${COMMON} const entry=state[${JSON.stringify(binding.composeId)}],expected=${JSON.stringify(input.to)}; if(!entry || entry.fingerprint!==${JSON.stringify(binding.fingerprint)} || entry.phase!=="filled" || !entry.dialog?.isConnected) throw Error("The original compose cannot be resumed"); const d=entry.dialog;
  const recipients=recipientState(d),chips=recipients.to.chips.filter(visible).map(e=>e.getAttribute("email")||e.getAttribute("data-hovercard-id"));
  if(recipients.extra || recipients.to.emails.some(e=>e!==expected.toLowerCase())) throw Error("Another recipient is present; do not overwrite it");
  let to=d.querySelector('input[aria-label="To recipients"],input[name="to"]');
  if(recipients.to.emails.length===1 && !norm(to?.value) && visibleRecipient(d,recipients.to)) return JSON.stringify({committed:true});
  const collapsed=Array.from(d.querySelectorAll('div,span')).filter(e=>visible(e)&&!e.children.length&&norm(e.textContent)==="Recipients"); if(collapsed.length===1){const control=collapsed[0].parentElement; if(!control?.matches('[tabindex]')) throw Error("The observed recipient control changed"); control.focus(); for(const type of ["mousedown","mouseup","click"]) control.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0}));}
  to=d.querySelector('input[aria-label="To recipients"],input[name="to"]'); if(!to || !visible(to) || recipients.to.emails.length) return JSON.stringify({waiting:true});
  if(norm(to.value) && norm(to.value).toLowerCase()!==expected.toLowerCase()) throw Error("The recipient field changed; do not overwrite it");
  ${phase === "type" ? `to.focus(); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(to,expected); to.dispatchEvent(new Event("input",{bubbles:true})); to.dispatchEvent(new Event("change",{bubbles:true})); to.dispatchEvent(new KeyboardEvent("keyup",{key:"c",code:"KeyC",bubbles:true})); return JSON.stringify({typed:true});` : `if(norm(to.value).toLowerCase()!==expected.toLowerCase()) throw Error("The recipient input did not retain the reviewed address"); to.focus(); for(const type of ["keydown","keypress","keyup"]) to.dispatchEvent(new KeyboardEvent(type,{key:"Enter",code:"Enter",keyCode:13,which:13,charCode:type==="keypress"?13:0,bubbles:true,cancelable:true})); to.blur(); d.querySelector('input[name="subjectbox"]')?.focus(); return JSON.stringify({commitRequested:true});`}
  })()`;
}
export function gmailRepairScript(binding: GmailDraftBinding, input: GmailDraftInput): string {
  return `(() => { ${COMMON} const entry=state[${JSON.stringify(binding.composeId)}],expected=${JSON.stringify(input.body)}; if(!entry || entry.fingerprint!==${JSON.stringify(binding.fingerprint)} || entry.phase!=="filled" || !entry.dialog?.isConnected) throw Error("The original compose cannot be resumed"); const body=entry.dialog.querySelector('[contenteditable="true"][role="textbox"]'); if(norm(body?.innerText)!==norm(expected)){ if(body?.textContent!==expected) throw Error("The message body changed; do not overwrite it"); body.innerText=expected; body.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:expected})); } return JSON.stringify({resumed:true}); })()`;
}
export function gmailCheckScript(binding: GmailDraftBinding, input: GmailDraftInput, send = false): string {
  // The upload binds immutable File bytes to the exact Gmail attachment nodes/links.
  // This proves the observed upload, not a download/hash of Gmail's server copy.
  // Final comparison and the single Send click share one synchronous script.
  return `(() => { ${COMMON}
    const entry=state[${JSON.stringify(binding.composeId)}], expected=${JSON.stringify({ ...input, files: input.files.map(({ base64: _, ...file }) => file) })};
    if(!entry || entry.phase!=="filled" || !entry.dialog?.isConnected) throw Error("The prepared compose is closed or unavailable");
    const d=entry.dialog, subject=d.querySelector('input[name="subjectbox"]'), body=d.querySelector('[contenteditable="true"][role="textbox"]');
    const recipients=recipientState(d), to=recipients.to;
    if(recipients.extra || to.pending || to.emails.length!==1 || to.emails[0]!==expected.to.toLowerCase() || !visibleRecipient(d,to) || norm(subject?.value)!==norm(expected.subject) || norm(body?.innerText)!==norm(expected.body) || body?.querySelector("img,video,audio")) throw Error("Recipient, subject or body changed; review again");
    if(entry.fingerprint!==${JSON.stringify(binding.fingerprint)}) throw Error("The reviewed attachment fingerprint changed");
    const links=Array.from(d.querySelectorAll('a[href]')).filter(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&u.searchParams.get("view")==="att"}catch{return false}});
    const names=links.map(a=>norm(a.querySelector('.vI,.aV3')?.textContent||a.textContent));
    const namesMatch=names.length===expected.files.length&&names.every((name,i)=>name===expected.files[i].name);
    const uploading=/\\bUploading\\b|Upload failed|Attachment failed/i.test(norm(d.innerText)) || !!d.querySelector('[role="progressbar"]');
    if(!namesMatch || uploading) { if(entry.attachmentProof) throw Error("The uploaded attachment set changed; review again"); return JSON.stringify({waiting:true,attachmentsVisible:namesMatch}); }
    const sourceBound=entry.files?.length===expected.files.length&&entry.files.every((f,i)=>f.name===expected.files[i].name&&f.size===expected.files[i].bytes);
    if(!sourceBound) throw Error("The original checked upload receipt is unavailable");
    if(!entry.attachmentProof) entry.attachmentProof=links.map((node,i)=>({node,href:node.href,file:entry.files[i]}));
    const proof=entry.attachmentProof;
    const exactFiles=proof.length===links.length&&proof.every((p,i)=>p.node===links[i]&&p.href===links[i].href&&p.file===entry.files[i]);
    if(!exactFiles) throw Error("The uploaded attachment identity changed; review again");
    ${send ? `const buttons=Array.from(d.querySelectorAll('[role="button"],button')).filter(e=>visible(e)&&/^Send(?:$| \\()/.test(norm(e.getAttribute("data-tooltip")||e.getAttribute("aria-label")||e.innerText))); if(buttons.length!==1) throw Error("Exactly one Send control is required"); entry.phase="send-requested"; buttons[0].click(); return JSON.stringify({sendRequested:true,fingerprint:entry.fingerprint,attachmentProof:"upload-bound"});` : `return JSON.stringify({verified:true,fingerprint:entry.fingerprint,attachmentsVisible:true,byteBoundAttachments:true,attachmentProof:"upload-bound"});`}
  })()`;
}
export async function runMeetingGmail(task: GmailDraftTask, opts: Options): Promise<Record<string, unknown>> {
  validate(task.input);
  const now = opts.now ?? Date.now, sleep = opts.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), policy = opts.policy ?? classifyAction;
  const check = () => { if (!opts.active()) throw Error("The meeting draft action was cancelled or changed."); };
  const fingerprint = gmailDraftFingerprint(task.input);
  check();
  let binding = task.binding;
  if (task.operation === "draft" && !binding) {
    const found = await opts.hands.request<{ tabs: BrowserTab[] }>("browser_tabs", { app: APP, allWindows: true }, 4000); check();
    const tabs = found.tabs.filter(t => allowed(t.url) && Number.isSafeInteger(t.windowId) && Number.isSafeInteger(t.tabId));
    if (tabs.length !== 1) throw Error("Open exactly one signed-in Gmail tab before preparing this draft. No other browser tab was changed.");
    const tab = tabs[0]!;
    binding = { app: APP, windowId: tab.windowId!, tabId: tab.tabId!, composeId: `hormes_${randomUUID()}`, fingerprint, verifiedAt: 0 };
  }
  if (!binding || binding.fingerprint !== fingerprint || binding.app !== APP) throw Error("The reviewed Gmail draft binding changed.");
  const target = { app: binding.app, windowId: binding.windowId, tabId: binding.tabId };
  const js = async (script: string, readOnly: boolean) => {
    check(); const page = await opts.hands.request<{ url: string }>("browser_url", target, 4000); check();
    if (!allowed(page.url)) throw Error("The bound tab is no longer Gmail.");
    const decision = policy({ kind: readOnly ? "browser_read" : "browser_click", app: APP, url: page.url, target: task.operation === "send" ? "Send" : "Compose draft", confirmed: task.operation === "send" && !!task.ownerApproved });
    if (decision.verdict !== "run") throw Error(`Gmail action blocked by policy: ${decision.reason}`);
    const guarded = `(() => { try { return ${script}; } catch(error) { return JSON.stringify({hormesError: String(error)}); } })()`;
    const result = await opts.hands.request<{ result: string }>("browser_js", { ...target, script: guarded, readOnly }, 12000); check();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(result.result) as Record<string, unknown>; } catch { throw Error("Gmail returned no structured result. Inspect the existing compose before retrying; no automatic replay occurred."); }
    if (parsed["hormesError"]) throw Error(String(parsed["hormesError"]));
    return parsed;
  };
  if (task.operation === "send") {
    const proof = task.ownerApproved;
    if (!proof || !proof.pendingId || proof.fingerprint !== gmailApprovalFingerprint(task.input, binding) || now() - proof.at < 0 || now() - proof.at > 30_000) throw Error("Fresh device-owner approval for this exact draft is required.");
    const result = await js(gmailCheckScript(binding, task.input, true), false);
    if (!result["sendRequested"]) throw Error("The draft was not ready to send; no Send control was pressed.");
    return { ...result, binding, status: "send-requested", deliveryVerified: false };
  }
  if (task.operation === "draft" && task.binding) {
    await js(gmailRepairScript(binding, task.input), false);
  } else if (task.operation === "draft") {
    const opened = await js(gmailOpenScript(binding.composeId, fingerprint), false);
    if (typeof opened["resumeComposeId"] === "string") binding = { ...binding, composeId: opened["resumeComposeId"] };
    if (opened["phase"] === "filled") await js(gmailRepairScript(binding, task.input), false);
    else for (let n = 0; n < 20; n++) { const result = await js(gmailFillScript(binding.composeId, task.input), false); if (result["filled"]) break; if (n === 19) throw Error("New Gmail compose did not become ready."); await sleep(250); }
  }
  if (task.operation === "draft") {
    let typed = false;
    for (let n = 0; n < 6; n++) { const result = await js(gmailRecipientScript(binding, task.input, "type"), false); if (result["committed"]) break; if (result["typed"]) { typed = true; break; } if (n === 5) throw Error("Gmail recipient control did not become visible."); await sleep(200); }
    if (typed) { await sleep(250); await js(gmailRecipientScript(binding, task.input, "commit"), false); await sleep(400); }
  }
  let stable = 0;
  for (let n = 0; n < 24; n++) {
    const result = await js(gmailCheckScript(binding, task.input), true);
    if (result["verified"] && ++stable >= 2) return { ...result, binding: { ...binding, verifiedAt: now() }, status: "draft-prepared", sent: false };
    if (n === 23) throw Error("Gmail has not confirmed the requested attachment in the compose window. The draft remains unsent.");
    await sleep(500);
  }
  throw Error("Gmail draft verification did not complete.");
}
