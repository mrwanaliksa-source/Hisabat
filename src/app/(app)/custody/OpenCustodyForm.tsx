"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";
import { openCustody } from "./actions";

type Opt = { id: string; name: string };
export function OpenCustodyForm({ t, banks, projects, members, payers, me }: { t: Dict; banks: Opt[]; projects: Opt[]; members: Opt[]; payers: string[]; me: string }) {
  const [src, setSrc] = useState(banks[0] ? `account:${banks[0].id}` : "external");
  const [loan, setLoan] = useState(true);
  return (
    <form action={openCustody} className="stack">
      <p className="muted small">{t.cus.directHint}</p>
      <div className="grid-2">
        <label className="field"><span>{t.cus.holderPick}<b className="req"> *</b></span>
          <select name="holder" defaultValue={me}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="field"><span>{t.cus.amount}<b className="req"> *</b></span>
          <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
        <label className="field"><span>{t.cus.project}</span>
          <select name="project"><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field"><span>{t.cus.date}</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      </div>
      <label className="field"><span>{t.cus.purpose}<b className="req"> *</b></span><textarea name="purpose" required rows={2} /></label>
      <label className="field"><span>{t.cus.source}</span>
        <select name="source" value={src} onChange={(e) => setSrc(e.target.value)}>
          {banks.map((b) => <option key={b.id} value={`account:${b.id}`}>{b.name}</option>)}
          <option value="external">{t.exp.extOpt}</option>
        </select></label>
      {src === "external" && (
        <div className="stack">
          <label className="field"><span>{t.exp.extWho}</span>
            <input name="ext_who" required list="cus-payers" placeholder={t.exp.extWhoPh} />
            <datalist id="cus-payers">{payers.map((n) => <option key={n} value={n} />)}</datalist></label>
          <label className="check"><input type="checkbox" name="ext_loan" value="1" checked={loan} onChange={(e) => setLoan(e.target.checked)} /> {t.exp.extLoan}</label>
          <p className="muted small">{loan ? t.exp.extHintLoan : t.exp.extHintGift}</p>
        </div>
      )}
      <button className="btn primary" data-act="open-custody">{t.cus.openNow}</button>
    </form>
  );
}
