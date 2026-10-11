import { useEffect, useState } from "react";
import type { WorkCommand, WorkState } from "./bridge";
import type { WorkSession } from "../../../packages/protocol/src/work.ts";
import { native } from "./bridge";
import { Canvas } from "./scholar/Canvas";
import { Icon } from "./icons";

type Props = { session: WorkSession; state: WorkState; voice: string; error: string; dismissError(): void; onStatus(text: string): void; act(input: Omit<WorkCommand, "requestId">): Promise<void>; close(): Promise<void> };
function Countdown({ endsAt, label, className }: { endsAt: number; label: string; className?: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <time className={className} aria-label={label}>{clock(endsAt - now)}</time>;
}
function clock(ms: number): string { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
export function LearningTools({ session, state, voice, error, dismissError, onStatus, act, close }: Props) {
  const surface = session.surface;
  const isBoard = !surface || surface.kind === "whiteboard";
  const isBreak = surface?.kind === "break";
  const asleep = ["asleep", "error", "paused"].includes(voice);
  const controls = <>
    {!session.classReview && <button className={`icon-button voice-${voice}`} disabled={voice === "connecting"} aria-label={asleep ? "Begin voice" : voice === "muted" ? "Resume microphone" : "Mute microphone"}
      aria-pressed={!asleep && voice !== "muted"} onClick={() => { if (asleep) void act({ action: "lesson.begin" }); else native("voice"); }}><Icon name={voice === "muted" ? "muted" : "mic"} /></button>}
    <button className="icon-button" aria-label="Save and close learning window" onClick={() => void close()}><Icon name="close" /></button>
  </>;
  return <main className={`tutor focused-tool ${isBreak ? "break-tool" : ""}`}>
    {/* Preserve and save the actual Scholar scene during timed tool changes. It is
        hidden from interaction and accessibility, never a tab behind a card. */}
    <div className="retained-board" hidden={!isBoard} aria-hidden={!isBoard} inert={!isBoard}>
      <Canvas key={session.id} session={session} onStatus={onStatus}><span className="tool-divider" />{controls}</Canvas>
    </div>
    {surface?.kind === "class-review" && <section className="class-review-pending" aria-label="Previous class review">
      <p>{session.classReview?.state === "failed" ? "Your lecture is saved. Retry the review." : "Preparing four questions from your previous lecture…"}</p>
      <div className="tool-controls">{session.classReview?.state === "failed" && <button className="icon-button" aria-label="Retry four-question review" onClick={() => void act({ action: "class.review.retry" })}>↻</button>}{controls}</div>
    </section>}
    {surface && (surface.kind === "flashcard" || surface.kind === "quiz") && <section key={surface.id} className={`recall-surface ${surface.kind}`} aria-label={surface.kind === "quiz" ? "Multiple choice quiz" : "Spoken recall card"}>
      <span className="card-position" aria-label={`Question ${surface.index} of ${surface.total}`}>{surface.index}<span> / {surface.total}</span></span>
      <div className={`recall-card ${surface.kind === "flashcard" ? "card-turn" : ""} ${surface.back ? "revealed" : ""}`}>
        <p className={`card-front ${surface.kind === "flashcard" ? "card-face front-face" : ""}`} aria-hidden={surface.kind === "flashcard" && !!surface.back}>{surface.front}</p>
        {surface.kind === "quiz" && surface.options && <div className="quiz-choices">
          {surface.options.map((option, index) => <button key={index} disabled={!!surface.attemptId} data-selected={state.recallAttempts?.find(a => a.id === surface.attemptId)?.choiceIndex === index} data-result={state.recallAttempts?.find(a => a.id === surface.attemptId)?.result} onClick={() => void act({ action: "quiz.answer", surfaceId: surface.id, choiceIndex: index })}><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}
        </div>}
        {surface.back && <p className={`card-back ${surface.kind === "flashcard" ? "card-face back-face" : ""}`} role="status">{surface.back}</p>}
      </div>
      <div className="tool-controls" role="toolbar" aria-label="Recall controls">
        {surface.attemptId && <button className="icon-button" aria-label={surface.kind === "quiz" && surface.index === surface.total ? session.classReview ? "Start next class" : "Finish quiz" : "Next question"} onClick={() => void act({ action: "tool.next" })}>→</button>}
        {controls}
      </div>
    </section>}
    {surface?.kind === "image" && <section className="image-surface" aria-label="Teaching image">
      <img src={surface.url} alt={surface.caption} referrerPolicy="no-referrer" onError={() => onStatus("This source image could not load. Ask the tutor to choose another source.")} />
      <div className="tool-controls" role="toolbar" aria-label="Image controls">{controls}</div>
    </section>}
    {surface?.kind === "break" && <section className="break-surface" aria-label={`Break: ${surface.reason}`}>
      <Countdown endsAt={surface.endsAt} label="Time remaining in break" />
      <button className="icon-button" aria-label="End break and return to saved work" onClick={() => void act({ action: "break.end" })}>→</button>
    </section>}
    {isBoard && session.recallPlan?.enabled && <Countdown className="recall-clock" endsAt={session.recallPlan.nextDueAt} label="Next spaced recall in" />}
    {error && <div className="lesson-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={dismissError}>×</button></div>}
    <span className="sr-only" role="status">{state.busy ? state.status : "Work saved in Console"}</span>
  </main>;
}
