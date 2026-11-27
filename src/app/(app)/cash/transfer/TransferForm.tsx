"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";
import { saveTransfer } from "./actions";

type Opt = { id: string; name: string };
export function TransferForm({ t, project, ours, partnerBanks, kv }: { t: Dict; project: string; ours: Opt[]; partnerBanks: Opt[]; kv: React.ReactNode }) {
  const [dir, setDir] = useState(partnerBanks.length ? "to_partner_bank" : "to_company");
  const banks = dir === "to_partner_bank" ? partnerBanks : ours;
  const needsBank = ["to_company", "to_partner", "to_partner_bank"].includes(dir);
  return (
    <form action={saveTransfer} className="card stack">
      <input type="hidden" name="project" value={project} />
      {kv}
      <label className="field"><span>{t.pp.direction}</span>
        <select name="direction" value={dir} onChange={(e) => setDir(e.target.value)}>
          {partnerBanks.length > 0 && <option value="to_partner_bank">{t.pp.toPartnerBank}</option>}
          <option value="to_company">{t.pp.toCompany}</option>
          <option value="to_partner">{t.pp.toPartner}</option>
          <option value="partner_paid_vat">{t.pp.paidVat}</option>
          <option value="partner_kept_share">{t.pp.keptShare}</option>
          <option value="partner_kept_zakat">{t.pp.keptZakat}</option>
        </select></label>
      {dir === "to_partner_bank" && <p className="muted small">{t.pp.toPartnerBankHint}</p>}
      <label className="field"><span>{t.cash.payAmount}</span>
        <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
      <label className="field"><span>{t.cash.date}</span>
        <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      {needsBank && (
        <label className="field"><span>{dir === "to_partner_bank" ? t.pp.partnerBanks : t.cash.bank}</span>
          <select name="bank" key={dir}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      )}
      <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
      <button className="btn primary" data-act="transfer">{t.pp.save}</button>
    </form>
  );
}
