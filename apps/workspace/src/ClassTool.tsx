import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkCommand, WorkSession, WorkState } from "../../../packages/protocol/src/work.ts";
import { Icon } from "./icons";
import { native } from "./bridge";

type Props = { session: WorkSession; state: WorkState; error: string; dismissError(): void; act(input: Omit<WorkCommand, "requestId">): Promise<void>; close(): Promise<void> };
/** NotchPrompt's dark contour and edge-faded text, adapted for real input captions.
 * The application clock follows speech; it never scrolls a prewritten script. */
export function ClassTool({ session, state, error, dismissError, act, close }: Props) {
  const lecture = session.lecture;
  const recording = lecture?.status === "recording";
  const caption = lecture?.draft || lecture?.caption;
  const answer = lecture?.answer;
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const pending = submitting || answer?.status === "thinking";
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); }, [caption]);
  useEffect(() => { if (composing) input.current?.focus(); }, [composing]);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    let lastHeight = 0;
    const measure = () => {
      // 74px outer padding/control space plus the native 34px notch crown.
      const height = Math.ceil(element.getBoundingClientRect().height + 108);
      if (height !== lastHeight) { lastHeight = height; native("lecture-layout", { sessionId: session.id, height }); }
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [session.id]);
  const toggle = () => act({ action: recording ? "lecture.pause" : "lecture.begin" });
  const submit = async () => {
    const question = text.trim();
    if (!question || pending) return;
    setSubmitting(true); setComposing(false); setText("");
    try { await act({ action: "lecture.question", sessionId: session.id, text: question }); }
    finally { setSubmitting(false); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && composing) { event.preventDefault(); event.stopImmediatePropagation(); setComposing(false); return; }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,[contenteditable=true]")) return;
      if (event.key.toLowerCase() === "q" && !event.metaKey && !event.ctrlKey && !event.altKey && !pending) { event.preventDefault(); setComposing(true); }
    };
    window.addEventListener("keydown", key, true); return () => window.removeEventListener("keydown", key, true);
  }, [composing, pending]);
  return <main className="class-tool" aria-label="Lecture captions">
    <span className={`capture-dot ${recording ? "recording" : ""}`} aria-label={recording ? "Lecture recording active" : "Lecture capture paused"} />
    <div className="class-content" ref={content}>
      <div ref={scroll} className="lecture-caption" aria-label="Teacher transcription" aria-live="off">
        <p key={caption ? "caption" : lecture?.status} className={caption ? "" : "caption-placeholder"}>
          {caption || (recording ? "Listening to the lecture…" : lecture?.status === "finished" ? "Lecture saved." : "Ready for the lecture.")}
        </p>
      </div>
      {(answer || submitting) && <section className="lecture-answer" aria-label="Written answer" aria-live="off" aria-busy={pending}>
        {answer?.question && !submitting && <p className="lecture-question-text">{answer.question}</p>}
        {answer?.status === "ready" && !submitting && <p className="lecture-answer-text">{answer.text}</p>}
        {answer?.status === "failed" && !submitting && <p className="lecture-answer-text">{answer.error || "The answer could not be prepared. Try asking again."}</p>}
        {pending && <span className="lecture-thinking" aria-label="Preparing a written answer"><i /><i /><i /></span>}
      </section>}
      {composing && <form className="lecture-question" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <input ref={input} value={text} onChange={event => setText(event.target.value)} maxLength={2000} aria-label="Question about this lecture" placeholder="Your question…" autoComplete="off" disabled={pending} />
        <button className="icon-button" type="submit" aria-label="Get a written answer; keep recording" disabled={!text.trim() || pending}><Icon name="next" /></button>
      </form>}
    </div>
    <div className="tool-controls" role="toolbar" aria-label="Class controls">
      <button className={`icon-button ${recording ? "capture-active" : ""}`} aria-label={recording ? "Pause lecture recording" : "Start lecture recording"} aria-pressed={recording} onClick={() => void toggle()}><Icon name={recording ? "pause" : "record"} /></button>
      <button className="icon-button" disabled={pending} aria-label="Ask a question in writing; keep recording" aria-pressed={composing} title="Ask a question (Q)" onClick={() => setComposing(value => !value)}><Icon name="question" /></button>
      <button className="icon-button" disabled={!lecture?.revision || state.busy} aria-label="End lecture and save notes and takeaways" onClick={() => void act({ action: "lecture.end" })}><Icon name="stop" /></button>
      <button className="icon-button" disabled={state.busy} aria-label="Enter next class with four-question review" onClick={() => void act({ action: "class.next" })}><Icon name="next" /></button>
      <button className="icon-button" aria-label="Save and fold into notch" onClick={() => void close()}><Icon name="close" /></button>
    </div>
    {error && <div className="lesson-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={dismissError}>×</button></div>}
    <span className="sr-only" role="status">{state.busy ? state.status : lecture?.notes ? "Lecture notes saved in Console" : "Transcript saved in Console"}</span>
  </main>;
}
