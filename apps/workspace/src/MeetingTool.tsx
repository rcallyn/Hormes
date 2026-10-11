import { useState } from "react";
import type { WorkCommand, WorkSession, WorkState } from "../../../packages/protocol/src/work.ts";
import { native } from "./bridge";
import { Icon } from "./icons";

type Props = { session: WorkSession; state: WorkState; error: string; dismissError(): void; act(input: Omit<WorkCommand, "requestId">): Promise<void>; close(): Promise<void> };
/** One focused surface follows the meeting. Saved originals and outputs live in Console. */
export function MeetingTool({ session, state, error, dismissError, act, close }: Props) {
  const [recap, setRecap] = useState("");
  const [addingRecap, setAddingRecap] = useState(false);
  const meeting = session.meeting;
  if (!meeting) return <main className="meeting-tool"><p>Resume the saved brief in Console, or start a new meeting to capture its follow-up.</p><button onClick={() => void close()}>Close</button></main>;
  const recording = meeting.status === "recording";
  const post = meeting.status === "finished" || !!meeting.followUp;
  const followUp = meeting.followUp;
  const stale = followUp && followUp.revision !== meeting.revision;
  const files = post && followUp ? meeting.attachments.filter(f => followUp.attachmentIds.includes(f.id)) : meeting.attachments;
  return <main className={`meeting-tool ${recording ? "meeting-capture" : ""}`} aria-label="Meeting workspace">
    <button className="meeting-fold icon-button" aria-label="Save and fold into notch" onClick={() => void close()}><Icon name="close" /></button>
    <div className="meeting-heading"><span>{recording ? "Capturing meeting" : post ? "Follow-up" : "Before your meeting"}</span>{session.demo && <small>Hypothetical day</small>}</div>
    {recording ? <div className="meeting-caption" aria-live="off"><span className="capture-dot recording" /><p>{meeting.draft || meeting.caption || "Listening…"}</p></div> : post ? <>
      {followUp ? <>
        <h1>{followUp.subject}</h1>{followUp.to && <p className="meeting-next">To: {followUp.to}</p>}<p className="meeting-email">{followUp.body}</p>
        {followUp.reconnect && <p className="meeting-next">{followUp.reconnect} · timing pending</p>}
      </> : <p className="meeting-placeholder">{state.busy ? "Preparing your follow-up…" : "Your meeting is saved. Prepare the requested follow-up."}</p>}
    </> : <>
      <h1>Go in prepared.</h1>
      {meeting.brief ? <article className="meeting-brief">{meeting.brief.text}</article> : <p className="meeting-placeholder">Your pitch, requested materials and questions for the conversation.</p>}
    </>}
    {!recording && files.length > 0 && <div className="meeting-files">{files.map(file => <button key={file.id} onClick={() => native("meeting-file", file.id)}><Icon name="file" /><span>{file.title}<small>{file.name} · {file.version}{file.demo ? " · demo" : ""}</small></span><span>↗</span></button>)}</div>}
    {!recording && addingRecap && <form className="meeting-recap" onSubmit={event => { event.preventDefault(); void act({ action: "recap", text: recap }); }}><textarea aria-label="Your meeting recap" placeholder="What did the investor request?" value={recap} onChange={event => setRecap(event.target.value)} /><button disabled={!recap.trim() || state.busy}>Save recap</button></form>}
    <div className="meeting-actions">
      {!recording && !post && <button disabled={state.busy} onClick={() => void act({ action: "meeting.prepare" })}>{meeting.brief ? "Refresh briefing" : "Prepare briefing"}</button>}
      {!recording && post && (!followUp || stale) && <button disabled={state.busy || !meeting.revision} onClick={() => void act({ action: "meeting.follow-up" })}>{followUp ? "Update follow-up" : "Prepare follow-up"}</button>}
      {!recording && followUp && !stale && (followUp.reviewedAt ? <>
        <button disabled={state.busy || (followUp.gmail?.status === "send-requested" || followUp.gmail?.status === "send-attempted")} onClick={() => void act({ action: "meeting.gmail-draft", sessionId: session.id, revision: followUp.revision, planId: followUp.id })}>{followUp.gmail ? "Recheck Gmail draft" : "Prepare Gmail draft"}</button>
        {followUp.gmail?.status === "draft-prepared" && <button disabled={state.busy || !followUp.gmail.byteBoundAttachments} onClick={() => void act({ action: "meeting.send", sessionId: session.id, revision: followUp.revision, planId: followUp.id })}>Authenticate & send</button>}
        <button className="icon-button" aria-label="Open local email draft file" onClick={() => native("meeting-draft")}><Icon name="file" /></button>
      </> : <button disabled={state.busy} onClick={() => void act({ action: "meeting.review", revision: followUp.revision, planId: followUp.id })}>Review email & deck</button>)}
      {!recording && <button className="icon-button" disabled={state.busy} aria-label="Add your explicit meeting recap" onClick={() => setAddingRecap(!addingRecap)}><Icon name="pen" /></button>}
      <button className={`icon-button ${recording ? "capture-active" : ""}`} disabled={state.busy} aria-label={recording ? "Pause meeting capture" : "Start meeting capture"} aria-pressed={recording} onClick={() => void act({ action: recording ? "meeting.pause" : "meeting.begin" })}><Icon name={recording ? "pause" : "record"} /></button>
      <button className="icon-button" disabled={state.busy || !meeting.revision} aria-label="End meeting and draft follow-up" onClick={() => void act({ action: "meeting.end" })}><Icon name="stop" /></button>
    </div>
    {!recording && post && <small className="meeting-status">{stale ? "New meeting information. Update the draft before review." : followUp?.gmail?.status === "send-attempted" ? "Send outcome unverified. Check Gmail; automatic repeat sending is disabled." : followUp?.gmail?.status === "send-requested" ? "Send requested. Check Gmail for delivery; automatic repeat sending is disabled." : followUp?.gmail ? followUp.gmail.byteBoundAttachments ? "Gmail draft remains unsent. Sending requires Touch ID or your Mac password." : "Gmail draft remains unsent. Attachment verification is unavailable; review and send manually in Gmail." : followUp?.reviewedAt ? "Reviewed locally. Open one signed-in Gmail tab to prepare the actual draft." : "Draft only. Review wording and files before sending."}</small>}
    {error && <div className="lesson-error" role="alert">{error}<button aria-label="Dismiss error" onClick={dismissError}>×</button></div>}
    <span className="sr-only" role="status">{state.busy ? state.status : session.next}</span>
  </main>;
}
