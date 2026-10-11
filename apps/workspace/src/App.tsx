import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LearningTools } from "./LearningTools";
import { ClassTool } from "./ClassTool";
import { MeetingTool } from "./MeetingTool";
import { GroceryTool } from "./GroceryTool";
import { command, native, subscribe, type WorkState, type WorkCommand } from "./bridge";
import type { TravelConstraints } from "../../../packages/protocol/src/work.ts";
import "./style.css";

function App() {
  const [state, setState] = useState<WorkState>();
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"ask" | "answer" | "problem" | null>(null);
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState("asleep");
  const report = useCallback((text: string) => { setStatus(text); if (!["Saving", "Saved in Console"].includes(text)) setError(text); }, []);
  useEffect(() => {
    const off = subscribe((reply) => { setState(reply.state); if (reply.voicePhase) setVoice(reply.voicePhase); if (!reply.ok) setError(reply.message ?? "Action failed"); });
    void command({ action: "refresh" }).then(() => setStatus("Saved in Console")).catch((e: Error) => setStatus(e.message));
    return off;
  }, []);
  const session = state?.active;
  const act = async (input: Omit<WorkCommand, "requestId">) => {
    try { await window.hormes.flush(); await command({ ...input, sessionId: input.sessionId ?? session?.id }); }
    catch (e) { report((e as Error).message); }
  };
  const close = async () => { try { await window.hormes.flush(); await command({ action: "pause" }); native("close"); } catch (e) { report((e as Error).message); } };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if (e.key === "Escape") { if (panel) setPanel(null); else void close(); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  });
  if (!session) return <main className="empty">{state?.offer ? <>
    <strong>{state.offer.title}</strong><p>{state.offer.reason}</p>
    <div><button onClick={() => void act({ action: "offer.accept", offerId: state.offer!.id })}>Continue</button><button onClick={() => void act({ action: "offer.dismiss", offerId: state.offer!.id })}>Dismiss</button></div>
  </> : <><p>{state?.quiet ? "Taking a break. Your work is saved." : "Your work, ready when you are."}</p><button onClick={() => native("console")}>Open Console</button></>}<p className="status" role="status">{status}</p></main>;
  const learning = ["study", "exam", "review"].includes(session.mode);
  if (session.mode === "coding") return <main className="coding-tool">
    <button className="coding-fold" aria-label="Save and close workspace" onClick={() => void close()}>⌃</button>
    <h1>EvoSim</h1><p>Build. Measure. Verify.</p>
    <div className="coding-actions"><button disabled={state!.busy} onClick={() => void act({ action: "ask", text: "Read work.context and the EvoSim README. Open Visual Studio Code with existing native tools, then delegate to Claude Code in the project folder named in the brief. Have it improve engine/candidate.mjs, run trusted correctness tests and repeated baseline/candidate benchmarks, and save the actual output with sources in work.artifact. Request the normal approvals when required. Do not install packages or handle API keys. Report failures clearly and leave the goal pending review." })}>Start Claude</button><button aria-label="Open saved coding work" onClick={() => native("console")}>↗</button></div>
    <p className="status" role="status">{error || (state!.busy ? state!.status : session.next)}</p>
  </main>;
  if (session.mode === "class") return <ClassTool key={session.id} session={session} state={state!} error={error} dismissError={() => setError("")} act={act} close={close} />;
  if (session.mode === "meeting") return <MeetingTool key={session.id} session={session} state={state!} error={error} dismissError={() => setError("")} act={act} close={close} />;
  if (session.mode === "grocery") return <GroceryTool key={session.id} session={session} state={state!} error={error} dismissError={() => setError("")} act={act} close={close} />;
  if (learning) return <LearningTools key={session.id} session={session} state={state!} voice={voice} error={error} dismissError={() => setError("")} onStatus={report} act={act} close={close} />;
  const evidence = state!.evidence.filter((e) => e.sessionId === session.id).slice(-2);
  return <main>
    <header><span className="identity">Hormes <span>· {session.mode}</span></span><span>{session.demo ? "Hypothetical day" : ""}</span><button aria-label="Save and close workspace" onClick={() => void close()}>⌃</button></header>
    <section className="working">
      <h1>{session.title}</h1>

      {session.mode === "travel" && <Travel key={session.id} initial={session.travel!} busy={state!.busy} onResearch={async (travel) => { try { await command({ action: "travel", travel, sessionId: session.id }); await act({ action: "ask", text: `Research travel from ${travel.origin} to ${travel.destination} on ${travel.date}, departing after ${travel.departAfter} and arriving before ${travel.arriveBefore} (local times). ${travel.preference}. Browse actual provider pages, compare viable options and save a sourced recommendation with review links. Do not book.` }); } catch (e) { report((e as Error).message); } }} />}
      {session.artifact && <Artifact text={session.artifact} state={state!} />}
      {state!.interventions.filter((i) => i.sessionId === session.id).map((i) => <div key={i.id}><p>{i.text}</p>{i.state === "proposed" ? <button onClick={() => void act({ action: "accept", interventionId: i.id })}>Accept as pending</button> : <small>Accepted · pending completion</small>}</div>)}
      <Sources ids={session.artifactSourceIds.length ? session.artifactSourceIds : session.sourceIds} state={state!} />
    </section>
    {panel && <section className="prompt" aria-label={panel === "answer" ? "Check your attempt" : "Tutor controls"}>
      <button className="dismiss" aria-label="Close controls" onClick={() => setPanel(null)}>×</button>
      {session.exercise && <p>{session.exercise.prompt}</p>}
      {panel !== "problem" && <form onSubmit={(e) => { e.preventDefault(); void act({ action: panel === "answer" ? "submit" : "ask", text }); setText(""); }}>
        <label>{panel === "answer" ? (session.exercise?.kind === "review" ? "Income" : session.exercise?.kind === "foundation" ? "Answer (fraction or decimal)" : "Price ; xA, yA, xB, yB (fractions allowed)") : "Ask the tutor"}<input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={panel === "answer" ? "Your answer" : "Walk me through the budget on the board"} /></label>
        <button disabled={!text.trim() || state!.busy}> {panel === "answer" ? "Check attempt" : "Ask"}</button>
      </form>}
      {evidence.map((e) => <p key={e.id} className={e.correct ? "correct" : "retry"}>{e.feedback}</p>)}
    </section>}
    <footer><div className="controls">

      <button onClick={() => setPanel(panel === "ask" ? null : "ask")}>Ask</button>
      <button aria-label={muted ? "Turn tutor speech on" : "Mute tutor speech"} aria-pressed={muted} onClick={() => { setMuted(!muted); native("speech", !muted); }}>{muted ? "Sound off" : "Sound on"}</button>
      <button aria-pressed={!['asleep', 'muted', 'paused', 'error'].includes(voice)} onClick={() => native("voice")}>{voice === "asleep" ? "Start voice" : voice === "muted" ? "Unmute mic" : `Mic · ${voice}`}</button><button onClick={() => native("console")}>Console</button>
    </div><span className="status" role="status">{state!.busy ? state!.status : status}</span></footer>
  </main>;
}
function Artifact({ text, state }: { text: string; state: WorkState }) {
  let readable = text;
  state.sources.forEach((source, index) => { readable = readable.replaceAll(source.id, `[${index + 1}]`); });
  return <article className="artifact">{readable.split(/(https?:\/\/[^\s)]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a> : part)}</article>;
}
function Sources({ ids, state }: { ids: string[]; state: WorkState }) {
  return <div className="sources">{state.sources.filter((s) => ids.includes(s.id)).map((s) => <p key={s.id}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">[{state.sources.indexOf(s) + 1}] {new URL(s.url).hostname} · {new Date(s.at).toLocaleTimeString()}</a> : s.path ? <button onClick={() => native("source", s.id)}>{s.title}</button> : <span>{s.title}</span>}</p>)}</div>;
}
function Travel({ initial, busy, onResearch }: { initial: TravelConstraints; busy: boolean; onResearch(value: TravelConstraints): Promise<void> }) {
  const [value, setValue] = useState(initial);
  return <form className="travel" onSubmit={(e) => { e.preventDefault(); void onResearch(value); }}>
    {([ ["origin", "From", "text"], ["destination", "To", "text"], ["date", "Date", "date"], ["departAfter", "Leave after", "time"], ["arriveBefore", "Arrive before", "time"], ["preference", "Priorities", "text"] ] as const).map(([key, label, type]) => <label key={key}>{label}<input type={type} required value={value[key]} onChange={(e) => setValue({ ...value, [key]: e.target.value })} /></label>)}
    <button disabled={busy}>Compare routes</button><small>Research only. Review the provider before booking.</small>
  </form>;
}
createRoot(document.getElementById("root")!).render(<App />);
