"use client";
import { useState } from "react";
import { saveExternal } from "./actions";
import type { Dict } from "@/lib/i18n";

const KINDS = ["owner_in", "loan_in", "income", "owner_out", "loan_out"] as const;
export type ExtInitial = { id?: string; kind: string; account?: string; amount?: string; date?: string; project?: string; who?: string; reference?: string; notes?: string };
export function ExternalForm({ t, banks, projects, lenders, initial }: { t: Dict; banks: { id: string; name: string }[];
  projects: { id: string; name: string }[]; lenders: string[]; initial?: ExtInitial }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>(((KINDS as readonly string[]).includes(initial?.kind ?? "") ? initial!.kind : "owner_in") as (typeof KINDS)[number]);
  const editing = !!initial?.id;
  const loan = kind === "loan_in" || kind === "loan_out";
  const out = kind === "owner_out" || kind === "loan_out";
  return (
    <form action={saveExternal} className={`card stack narrow-form ${editing ? "editing" : ""}`} id="ext-form">
      {editing && <><input type="hidden" name="edit_id" value={initial!.id} /><p className="alert warn small">{t.ext.editing}</p></>}
      <div className="seg">
        {KINDS.map((k) => (
          <label key={k} className={kind === k ? "on" : ""}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />{t.ext.k[k]}
          </label>
        ))}
      </div>
      <p className="muted small">{t.ext.h[kind]}</p>
      <div className="grid-2">
        <label className="field"><span>{out ? t.ext.fromAcc : t.ext.toAcc}</span>
          <select name="account" defaultValue={initial?.account ?? banks.find((b) => b.name.includes("1020"))?.id ?? banks[0]?.id}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
        <label className="field"><span>{t.cash.payAmount}<b className="req"> *</b></span>
          <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" defaultValue={initial?.amount} /></label>
        {loan && (
          <label className="field"><span>{t.ext.who}<b className="req"> *</b></span>
            <input name="who" required list="lenders" defaultValue={initial?.who} /><datalist id="lenders">{lenders.map((l) => <option key={l} value={l} />)}</datalist></label>
        )}
        <label className="field"><span>{t.cash.date}</span>
          <input type="date" name="date" required defaultValue={initial?.date || new Date().toISOString().slice(0, 10)} /></label>
        <label className="field"><span>{t.mv.whose}</span>
          <select name="project" defaultValue={initial?.project ?? ""}><option value="">{t.mv.general}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" defaultValue={initial?.reference} /></label>
      </div>
      <label className="field"><span>{t.mv.notes}</span><input name="notes" defaultValue={initial?.notes} /></label>
      {editing && <label className="field"><span>{t.exp.reason}<b className="req"> *</b></span><input name="reason" required /></label>}
      <div className="actions">
        <button className="btn primary self-start" data-act="external">{editing ? t.ext.saveEdit : t.ext.save}</button>
        {editing && <a href="/cash/external" className="btn ghost">{t.form.cancel}</a>}
      </div>
    </form>
  );
}
