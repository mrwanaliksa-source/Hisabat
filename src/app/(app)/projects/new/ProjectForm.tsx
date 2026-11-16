"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createProject, type FormState } from "./actions";
import type { Dict } from "@/lib/i18n";

type Opt = { id: string; name: string };
type Props = { t: Dict["form"]; pp: Dict["pp"]; sar: string; customers: Opt[]; partners: Opt[]; lang: "ar" | "en" };

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const toNum = (s: string) => {
  const v = Number(s.replace(/,/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  return Number.isFinite(v) ? v : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function ProjectForm({ t, pp, sar, customers, partners }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createProject, {});

  const [customerId, setCustomerId] = useState("");
  const [contract, setContract] = useState("");
  const [adv, setAdv] = useState("");
  const [rec, setRec] = useState("");
  const [recTouched, setRecTouched] = useState(false);
  const [ret, setRet] = useState("");
  const [holder, setHolder] = useState<"company" | "partner">("company");
  const [hasPartnerRaw, setHasPartner] = useState(false);
  const hasPartner = holder === "partner" || hasPartnerRaw;
  const [basis, setBasis] = useState<"collections" | "profit_at_close">("collections");
  const effBasis = basis;
  const [partnerId, setPartnerId] = useState("");
  const [share, setShare] = useState("");
  const [sample, setSample] = useState("100000");

  // same maths as the database (adopted method A)
  const work = toNum(sample);
  const recovery = r2(work * toNum(recTouched ? rec : adv) / 100);
  const retention = r2(work * toNum(ret) / 100);
  const vatBase = r2(work - recovery);
  const vat = r2(vatBase * 0.15);
  const due = r2(vatBase + vat - retention);
  const netDue = r2(vatBase - retention);
  const partnerShare = hasPartner && effBasis === "collections" ? r2(netDue * toNum(share) / 100) : 0;

  return (
    <form action={action} className="form-grid">
      <div className="form-main stack-lg">
        {/* ---------- basics ---------- */}
        <fieldset className="card">
          <legend>{t.basics}</legend>
          <div className="grid-2">
            <Field label={t.code} required><input name="code" required dir="ltr" placeholder="P-001" /></Field>
            <Field label={t.contractValue}>
              <input name="contract_value" inputMode="decimal" dir="ltr" value={contract}
                     onChange={(e) => setContract(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label={t.nameAr} required><input name="name_ar" required /></Field>
            <Field label={t.nameEn}><input name="name_en" dir="ltr" /></Field>
            <Field label={t.startDate}><input type="date" name="start_date" /></Field>
            <Field label={t.endDate}><input type="date" name="end_date" /></Field>
            <Field label={t.manager}><input name="manager_name" /></Field>
            <Field label={t.budget}><input name="budget" inputMode="decimal" dir="ltr" placeholder="0.00" /></Field>
          </div>
        </fieldset>

        {/* ---------- customer ---------- */}
        <fieldset className="card">
          <legend>{t.customer}</legend>
          {customers.length > 0 && (
            <Field label={t.chooseCustomer}>
              <select name="customer_id" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">{t.none}</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {!customerId && (
            <>
              {customers.length > 0 && <p className="muted small">{t.orNewCustomer}</p>}
              <div className="grid-2">
                <Field label={t.newCustomerName} required={!customerId}><input name="customer_name" required={!customerId} /></Field>
                <Field label={t.customerVat}><input name="customer_vat" dir="ltr" inputMode="numeric" maxLength={15} /></Field>
              </div>
              <label className="check"><input type="checkbox" name="customer_is_government" /> {t.government}</label>
            </>
          )}
        </fieldset>

        {/* ---------- advance & retention ---------- */}
        <fieldset className="card">
          <legend>{t.terms}</legend>
          <div className="grid-2">
            <Field label={t.advancePct}>
              <input name="advance_pct" inputMode="decimal" dir="ltr" value={adv} placeholder="0"
                     onChange={(e) => setAdv(e.target.value)} />
            </Field>
            <Field label={t.recoveryPct}>
              <input name="recovery_pct" inputMode="decimal" dir="ltr" placeholder="0"
                     value={recTouched ? rec : adv}
                     onChange={(e) => { setRecTouched(true); setRec(e.target.value); }} />
            </Field>
            <Field label={t.retentionPct}>
              <input name="retention_pct" inputMode="decimal" dir="ltr" value={ret} placeholder="0"
                     onChange={(e) => setRet(e.target.value)} />
            </Field>
            <Field label={t.retentionCap}><input name="retention_cap_pct" inputMode="decimal" dir="ltr" placeholder="—" /></Field>
          </div>
          {toNum(adv) > 0 && toNum(contract) > 0 && (
            <p className="hint num-inline">= {fmt(r2(toNum(contract) * toNum(adv) / 100))} {sar}</p>
          )}
          <Field label={t.releaseTerms}><input name="retention_release_terms" placeholder={t.releaseHint} /></Field>
          <p className="note">{t.vatNote}</p>
        </fieldset>

        {/* ---------- partner ---------- */}
        <fieldset className="card">
          <legend>{t.partner}</legend>
          <div className="field">
            <span>{pp.holder}</span>
            <div className="seg" role="radiogroup">
              {(["company", "partner"] as const).map((k) => (
                <label key={k} className={holder === k ? "on" : ""}>
                  <input type="radio" name="contract_holder" value={k} checked={holder === k}
                         onChange={() => { setHolder(k); setBasis(k === "partner" ? "profit_at_close" : "collections"); }} />
                  {k === "company" ? pp.holderCompany : pp.holderPartner}
                </label>
              ))}
            </div>
          </div>
          {holder === "partner" && <p className="note">{pp.holderHint}</p>}
          {holder === "company" ? (
            <label className="toggle">
              <input type="checkbox" name="has_partner" checked={hasPartner} onChange={(e) => setHasPartner(e.target.checked)} />
              <span className="toggle-ui" aria-hidden />
              {t.hasPartner}
            </label>
          ) : <input type="hidden" name="has_partner" value="on" />}
          {hasPartner && (
            <div className="stack">
              {partners.length > 0 && (
                <Field label={t.choosePartner}>
                  <select name="partner_id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
                    <option value="">{t.none}</option>
                    {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}
              <div className="grid-2">
                {!partnerId && <Field label={t.newPartnerName} required><input name="partner_name" required /></Field>}
                <Field label={t.sharePct} required>
                  <input name="share_pct" inputMode="decimal" dir="ltr" required value={share} placeholder="10"
                         onChange={(e) => setShare(e.target.value)} />
                </Field>
                <Field label={t.partnerFrom}><input type="date" name="partner_from" /></Field>
                <Field label={pp.basis}>
                  <select name="basis" value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
                    <option value="profit_at_close">{pp.basisProfit}</option>
                    <option value="collections">{pp.basisCollections}</option>
                  </select>
                </Field>
                {holder === "partner" && (
                  <Field label={pp.vatPeriod}>
                    <select name="partner_vat_period" defaultValue="quarterly">
                      <option value="monthly">{pp.monthly}</option>
                      <option value="quarterly">{pp.quarterly}</option>
                    </select>
                  </Field>
                )}
              </div>
              <p className="note">{effBasis === "collections" ? t.partnerNote : `${pp.profitNote} ${pp.lossNote}`}</p>
            </div>
          )}
        </fieldset>

        {state.error && <p className="alert error">{state.error}</p>}
        <div className="actions">
          <button className="btn primary" disabled={pending}>{pending ? t.saving : t.save}</button>
          <Link href="/projects" className="btn ghost">{t.cancel}</Link>
        </div>
      </div>

      {/* ---------- live preview ---------- */}
      <aside className="form-side">
        <div className="card preview">
          <h3>{t.preview}</h3>
          <Field label={t.workValue}>
            <input inputMode="decimal" dir="ltr" value={sample} onChange={(e) => setSample(e.target.value)} />
          </Field>
          <dl>
            <Row k={t.recovery} v={-recovery} />
            <Row k={t.vatBase} v={vatBase} strong />
            <Row k={t.vat} v={vat} />
            <Row k={t.retention} v={-retention} />
            <Row k={t.due} v={due} strong accent />
            <Row k={t.netDue} v={netDue} />
            {hasPartner && effBasis === "collections" && <Row k={t.partnerShare} v={partnerShare} accent />}
          </dl>
          <p className="muted small">{sar}</p>
        </div>
      </aside>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}{required && <b className="req"> *</b>}</span>
      {children}
    </label>
  );
}

function Row({ k, v, strong, accent }: { k: string; v: number; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`row ${strong ? "strong" : ""} ${accent ? "accent" : ""}`}>
      <dt>{k}</dt>
      <dd className="num">{v < 0 ? `(${fmt(-v)})` : fmt(v)}</dd>
    </div>
  );
}
