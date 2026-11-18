"use client";
import { useState } from "react";
import { saveMove } from "./actions";
import { fmt } from "@/lib/calc";
import type { Dict } from "@/lib/i18n";

type B = { id: string; name: string; balance: number; projectId: string | null };
export function MoveForm({ t, banks, projects }: { t: Dict; banks: B[]; projects: { id: string; name: string }[] }) {
  const [from, setFrom] = useState(banks[0]?.id ?? "");
  const [to, setTo] = useState(banks[1]?.id ?? "");
  const [project, setProject] = useState(banks[0]?.projectId ?? "");
  const fb = banks.find((b) => b.id === from);
  return (
    <form action={saveMove} className="card stack narrow-form">
      <p className="muted small">{t.mv.hint}</p>
      <div className="grid-2">
        <label className="field"><span>{t.mv.from}</span>
          <select name="from" value={from} onChange={(e) => { setFrom(e.target.value); setProject(banks.find((b) => b.id === e.target.value)?.projectId ?? ""); }}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name} — {fmt(b.balance)}</option>)}
          </select></label>
        <label className="field"><span>{t.mv.to}</span>
          <select name="to" value={to} onChange={(e) => setTo(e.target.value)}>
            {banks.filter((b) => b.id !== from).map((b) => <option key={b.id} value={b.id}>{b.name} — {fmt(b.balance)}</option>)}
          </select></label>
        <label className="field"><span>{t.cash.payAmount}<b className="req"> *</b></span>
          <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" />
          {fb && <small className="muted">{t.mv.available} {fmt(fb.balance)}</small>}</label>
        <label className="field"><span>{t.cash.date}</span>
          <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label className="field"><span>{t.mv.whose}</span>
          <select name="project" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">{t.mv.general}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <small className="muted">{t.mv.whoseHint}</small></label>
        <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
      </div>
      <label className="field"><span>{t.mv.notes}</span><input name="notes" placeholder={t.mv.notesHint} /></label>
      <button className="btn primary self-start" data-act="move">{t.mv.save}</button>
    </form>
  );
}
