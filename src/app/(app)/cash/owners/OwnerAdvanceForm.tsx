"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";
import { saveOwnerAdvance } from "./actions";

type Opt = { id: string; name: string };
export function OwnerAdvanceForm({ t, owners, banks, projects, payers }: { t: Dict; owners: Opt[]; banks: Opt[]; projects: Opt[]; payers: string[] }) {
  const [kind, setKind] = useState<"advance" | "repay">("advance");
  const [src, setSrc] = useState(banks[0] ? `account:${banks[0].id}` : "external");
  const [loan, setLoan] = useState(true);
  const ext = kind === "advance" && src === "external";
  return (
    <form action={saveOwnerAdvance} className="card stack narrow-form">
      <div className="seg">
        {(["advance", "repay"] as const).map((k) => (
          <label key={k} className={kind === k ? "on" : ""}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => { setKind(k); if (k === "repay" && src === "external") setSrc(banks[0] ? `account:${banks[0].id}` : ""); }} />{t.own.k[k]}
          </label>
        ))}
      </div>
      <label className="field"><span><b>{kind === "advance" ? t.own.srcTitle : t.own.intoTitle}</b></span>
        <select name="source" value={src} onChange={(e) => setSrc(e.target.value)} data-field="source">
          {banks.map((b) => <option key={b.id} value={`account:${b.id}`}>{b.name}</option>)}
          {kind === "advance" && <option value="external">{t.exp.extOpt}</option>}
        </select></label>
      {ext && (
        <div className="stack">
          <label className="field"><span>{t.exp.extWho}<b className="req"> *</b></span>
            <input name="ext_who" required list="own-payers" placeholder={t.exp.extWhoPh} />
            <datalist id="own-payers">{payers.map((n) => <option key={n} value={n} />)}</datalist></label>
          <label className="check"><input type="checkbox" name="ext_loan" value="1" checked={loan} onChange={(e) => setLoan(e.target.checked)} /> {t.exp.extLoan}</label>
          <p className="muted small">{loan ? t.exp.extHintLoan : t.exp.extHintGift}</p>
        </div>
      )}
      <div className="grid-2">
        <label className="field"><span>{t.own.name}<b className="req"> *</b></span>
          <select name="owner" required>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="field"><span>{t.own.onProject}</span>
          <select name="project" defaultValue=""><option value="">{t.own.noProject}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>{t.cash.payAmount}<b className="req"> *</b></span>
          <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
        <label className="field"><span>{t.cash.date}</span><input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      </div>
      <label className="field"><span>{t.mv.notes}</span><input name="notes" /></label>
      <button className="btn primary self-start" data-act="owner-advance">{t.own.save}</button>
    </form>
  );
}
