import { useState } from "react";
import type { WorkCommand, WorkSession, WorkState } from "../../../packages/protocol/src/work.ts";
import { command } from "./bridge";
import { Icon } from "./icons";

type Props = { session: WorkSession; state: WorkState; error: string; dismissError(): void; act(input: Omit<WorkCommand, "requestId">): Promise<void>; close(): Promise<void> };
const labels = { pending: "Pending", "in-cart": "In cart", unavailable: "Unavailable", "substitution-needs-review": "Review substitute" } as const;
function reviewURL(value: string | undefined): string | undefined {
  if (!value) return;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password && (url.hostname === "instacart.com" || url.hostname.endsWith(".instacart.com"))) return url.href; } catch { /* Invalid receipt links remain plain text. */ }
}
/** The requested list remains visible; model plans and browser evidence stay inspectable. */
export function GroceryTool({ session, state, error, dismissError, act, close }: Props) {
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [importError, setImportError] = useState("");
  const grocery = session.grocery;
  if (!grocery) return <main className="grocery-tool"><p>Open a new grocery session from Console.</p><button onClick={() => void close()}>Fold</button></main>;
  const source = state.sources.find(s => s.id === grocery.note?.sourceId);
  const review = grocery.review;
  const cartURL = review ? state.sources.filter(s => review.receiptIds.includes(s.id) && /\b(?:your cart|shopping cart|items in (?:your )?cart)\b/i.test(s.text)).map(s => reviewURL(s.url)).filter(Boolean).at(-1) : undefined;
  const inCart = grocery.items.filter(i => i.state === "in-cart").length;
  const busy = state.busy || saving;
  const savePaste = async () => {
    setSaving(true); setImportError(""); dismissError();
    try { await command({ action: "grocery.import", sessionId: session.id, title: "Pasted grocery list", text }); setPasting(false); setText(""); }
    catch (e) { setImportError((e as Error).message); }
    finally { setSaving(false); }
  };
  return <main className="grocery-tool" aria-label="Grocery cart preparation">
    <button className="grocery-fold icon-button" aria-label="Save and fold into notch" onClick={() => void close()}><Icon name="close" /></button>
    <div className="grocery-heading"><span>{review ? "Ready for your review" : "Groceries"}</span>{session.demo ? <small>Hypothetical day</small> : null}</div>
    <h1>{grocery.note?.title ?? "One less thing."}</h1>
    {!grocery.note ? <p className="grocery-intro">Select your grocery note in Apple Notes. Hormes will prepare the cart and stop before checkout.</p> : <>
      <div className="grocery-origin"><span>{grocery.note.origin === "apple-notes" ? "Selected Apple Note" : "Pasted list"}</span><span>{inCart} / {grocery.items.length} in cart</span></div>
      <ul className="grocery-items">{grocery.items.map(item => <li key={item.id} data-state={item.state}>
        <span className="grocery-mark" aria-hidden="true">{item.state === "in-cart" ? "✓" : item.state === "pending" ? "○" : "!"}</span>
        <div><strong>{item.request}</strong>{item.product ? <span>{item.product}{item.priceText ? ` · ${item.priceText}` : ""}</span> : null}
          {item.quote ? <details><summary>Browser evidence</summary><p>{item.quote}</p>{reviewURL(item.url) ? <a href={reviewURL(item.url)} target="_blank" rel="noreferrer">Open source ↗</a> : null}</details> : null}
        </div><small>{labels[item.state]}</small>
      </li>)}</ul>
    </>}
    {grocery.blocked ? <p className="grocery-blocked" role="status">{grocery.blocked.reason}</p> : null}
    {review ? <p className="grocery-review">{review.summary}</p> : null}
    {pasting ? <form className="grocery-paste" onSubmit={event => { event.preventDefault(); void savePaste(); }}>
      <label htmlFor="grocery-list">Paste your list · one item per line</label>
      <textarea id="grocery-list" value={text} maxLength={12000} onChange={event => setText(event.target.value)} placeholder={"Milk\nEggs\nBananas"} autoFocus />
      <div><button disabled={busy || !text.trim()}>Save list</button><button type="button" disabled={saving} onClick={() => setPasting(false)}>Cancel</button></div>
    </form> : <div className="grocery-actions">
      {cartURL ? <a className="grocery-primary" href={cartURL} target="_blank" rel="noreferrer">Review cart ↗</a> : <button disabled={busy} onClick={() => { dismissError(); void act({ action: "grocery.run" }); }}>{busy ? "Preparing…" : grocery.note ? "Prepare cart" : "Read selected note & prepare"}</button>}
      <button className="icon-button" disabled={busy} aria-label={grocery.note ? "Replace with a pasted grocery list" : "Paste a grocery list instead"} onClick={() => setPasting(true)}><Icon name="pen" /></button>
      {review ? <button disabled={busy} onClick={() => { dismissError(); void act({ action: "grocery.run" }); }}>Recheck</button> : null}
    </div>}
    {grocery.note ? <details className="grocery-saved"><summary>Saved list & plan</summary><p className="grocery-original">{source?.text ?? "Original list is saved in Console."}</p>{grocery.plan.length ? <><small>Hormes’ execution checklist</small><ol>{grocery.plan.map(step => <li key={step.id}>{step.text}</li>)}</ol></> : null}</details> : null}
    {error || importError ? <div className="lesson-error" role="alert">{importError || error}<button aria-label="Dismiss error" onClick={() => { setImportError(""); dismissError(); }}>×</button></div> : null}
    <span className="sr-only" role="status">{busy ? "Preparing the requested cart. Nothing will be purchased." : session.next}</span>
  </main>;
}
