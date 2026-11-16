"use client";
import { useState } from "react";
import type { Dict } from "@/lib/i18n";

type Current = { partnerId: string; name: string; pct: number; basis: "collections" | "profit_at_close"; from: string; vatPeriod: string };
type Props = {
  t: Dict; closed: boolean; holder: "company" | "partner"; holderLocked: boolean; basisLocked: boolean; needsEffectiveDate: boolean;
  current: Current | null; history: { pct: number; from: string; to: string | null }[]; partners: { id: string; name: string }[];
};
const fmtPct = (f: number) => `${Math.round(f * 10000) / 100}%`;

export function PartnerTerms({ t, closed, holder: h0, holderLocked, basisLocked, needsEffectiveDate, current, history, partners }: Props) {
  const [adding, setAdding] = useState(!current);
  const [holder, setHolder] = useState(h0);
  const [pct, setPct] = useState(current ? String(Math.round(current.pct * 10000) / 100) : "");
  const [basis, setBasis] = useState(current?.basis ?? (h0 === "partner" ? "profit_at_close" : "collections"));
  const [partnerId, setPartnerId] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const name = current?.name || partners.find((p) => p.id === partnerId)?.name || partnerName || "…";
  const pctText = pct ? `${pct}%` : "…";
  const changedPct = current && Number(pct) / 100 !== current.pct;

  return (
    <fieldset className="card">
      <legend>{t.detail.partnerSection}</legend>

      {/* plain-language summary of how it works now */}
      <div className="explain">
        <b>{t.detail.howNow}</b>
        <p>{holder === "partner" ? t.detail.explHolderPartner.replace("{name}", name) : t.detail.explHolderCompany}</p>
        {(current || adding) && <p>{(basis === "collections" ? t.detail.explCollections : t.detail.explProfit).replace("{pct}", pctText)}</p>}
        {!current && !adding && <p>{t.detail.noPartnerYet}</p>}
      </div>

      {closed ? <p className="alert warn">{t.pp.closed}</p> : (
        <>
          <div className="field">
            <span>{t.pp.holder}</span>
            <div className="seg">
              {(["company", "partner"] as const).map((k) => (
                <label key={k} className={holder === k ? "on" : ""} aria-disabled={holderLocked}>
                  <input type="radio" name="contract_holder" value={k} checked={holder === k} disabled={holderLocked && holder !== k}
                         onChange={() => { setHolder(k); if (!basisLocked && k === "partner") setBasis("profit_at_close"); }} />
                  {k === "company" ? t.pp.holderCompany : t.pp.holderPartner}
                </label>
              ))}
            </div>
            {holderLocked && <small className="muted">{t.detail.holderLocked}</small>}
            {holderLocked && <input type="hidden" name="contract_holder" value={holder} />}
          </div>

          {!current && !adding && (
            <button type="button" className="btn soft self-start" onClick={() => setAdding(true)}>{t.detail.addPartner}</button>
          )}

          {(current || adding) && (
            <div className="grid-2">
              {current ? (
                <label className="field"><span>{t.cash.partner}</span><input value={current.name} readOnly className="computed" /></label>
              ) : (
                <>
                  {partners.length > 0 && (
                    <label className="field"><span>{t.form.choosePartner}</span>
                      <select name="partner_id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                        <option value="">—</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select></label>
                  )}
                  {!partnerId && (
                    <label className="field"><span>{t.form.newPartnerName}</span>
                      <input name="partner_name" value={partnerName} onChange={(e) => setPartnerName(e.target.value)} /></label>
                  )}
                </>
              )}
              <label className="field"><span>{t.form.sharePct}<b className="req"> *</b></span>
                <input name="share_pct" dir="ltr" inputMode="decimal" required value={pct} onChange={(e) => setPct(e.target.value)} /></label>
              <label className="field"><span>{t.pp.basis}</span>
                <select name="basis" value={basis} disabled={basisLocked} onChange={(e) => setBasis(e.target.value as typeof basis)}>
                  <option value="collections">{t.pp.basisCollections}</option>
                  <option value="profit_at_close">{t.pp.basisProfit}</option>
                </select>
                {basisLocked && <><input type="hidden" name="basis" value={basis} /><small className="muted">{t.detail.basisLocked}</small></>}
              </label>
              {holder === "partner" && (
                <label className="field"><span>{t.pp.vatPeriod}</span>
                  <select name="partner_vat_period" defaultValue={current?.vatPeriod ?? "quarterly"}>
                    <option value="monthly">{t.pp.monthly}</option><option value="quarterly">{t.pp.quarterly}</option>
                  </select></label>
              )}
              {needsEffectiveDate && changedPct && (
                <label className="field"><span>{t.detail.effectiveFrom}<b className="req"> *</b></span>
                  <input type="date" name="effective_from" required defaultValue={new Date().toISOString().slice(0, 10)} />
                  <small className="muted">{t.detail.effectiveHint}</small></label>
              )}
            </div>
          )}

          {history.length > 1 && (
            <div className="stack">
              <b className="small">{t.detail.history}</b>
              <ul className="plain-list small">
                {history.map((h, i) => <li key={i}><span className="num">{fmtPct(h.pct)}</span> · <span className="num">{h.from} → {h.to ?? "…"}</span></li>)}
              </ul>
            </div>
          )}

          {(current || adding) && <button className="btn primary self-start" data-act="save-partner">{t.detail.savePartner}</button>}
        </>
      )}
    </fieldset>
  );
}
