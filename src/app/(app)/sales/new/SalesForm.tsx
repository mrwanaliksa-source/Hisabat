"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createSalesDoc, type FormState } from "./actions";
import { calcDoc, fmt, r2, toNum, type DocType, type ProjectTerms } from "@/lib/calc";
import type { Dict } from "@/lib/i18n";

type Opt = { terms: ProjectTerms; label: string; customer: string; government: boolean; partnerShare: number };
type Props = { t: Dict; projects: Opt[]; initialProject: string; initialType: string };

export function SalesForm({ t, projects, initialProject, initialType }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createSalesDoc, {});
  const [projectId, setProjectId] = useState(initialProject || (projects.length === 1 ? projects[0].terms.id : ""));
  const [type, setType] = useState<DocType>((["advance", "progress_claim", "retention_release", "other"].includes(initialType) ? initialType : "progress_claim") as DocType);
  const [work, setWork] = useState("");
  const [discount, setDiscount] = useState("");
  const [printed, setPrinted] = useState("");

  const p = projects.find((x) => x.terms.id === projectId) ?? null;
  const c = calcDoc(type, toNum(work), toNum(discount), p?.terms ?? null);
  const printedN = printed.trim() === "" ? null : toNum(printed);
  const match = printedN == null ? null : Math.abs(printedN - c.invoiceTotal) <= 0.05;
  const share = p ? r2(c.netDue * p.partnerShare) : 0;

  const valueLabel = type === "advance" ? t.sales.advanceValue : type === "retention_release" ? t.sales.releaseValue
    : type === "other" ? t.sales.otherValue : t.sales.workValue;

  return (
    <form action={action} className="form-grid">
      <div className="form-main stack-lg">
        <fieldset className="card">
          <legend>{t.sales.project}</legend>
          <label className="field">
            <span>{t.sales.chooseProject}<b className="req"> *</b></span>
            <select name="project_id" required value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">—</option>
              {projects.map((o) => <option key={o.terms.id} value={o.terms.id}>{o.label}</option>)}
            </select>
          </label>
          {p && <p className="muted small">{t.cash.customer}: <b>{p.customer}</b></p>}

          <div className="seg" role="radiogroup" aria-label={t.sales.docType}>
            {(["progress_claim", "advance", "retention_release", "other"] as DocType[]).map((k) => (
              <label key={k} className={type === k ? "on" : ""}>
                <input type="radio" name="doc_type" value={k} checked={type === k} onChange={() => setType(k)} />
                {t.docType[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>{t.sales.calc}</legend>
          <div className="grid-2">
            <label className="field">
              <span>{valueLabel}<b className="req"> *</b></span>
              <input name="work_value" inputMode="decimal" dir="ltr" required value={work} onChange={(e) => setWork(e.target.value)} placeholder="0.00" />
            </label>
            {type !== "retention_release" && (
              <label className="field">
                <span>{t.sales.discount}</span>
                <input name="discount" inputMode="decimal" dir="ltr" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
              </label>
            )}
          </div>
          {p && type === "progress_claim" && (
            <p className="muted small">{t.sales.advanceLeft}: <b className="num">{fmt(p.terms.advance_outstanding)}</b></p>
          )}
          {p && type === "retention_release" && (
            <p className="muted small">{t.sales.retentionLeft}: <b className="num">{fmt(p.terms.retention_outstanding)}</b></p>
          )}
          {c.error === "release" && <p className="alert error">{t.sales.releaseTooBig}</p>}
        </fieldset>

        <fieldset className="card">
          <legend>{t.sales.issuerRef}</legend>
          <div className="grid-2">
            <label className="field"><span>{t.sales.issuerRef}</span><input name="issuer_ref" dir="ltr" placeholder="INV-2026-0001" /></label>
            <label className="field">
              <span>{t.sales.printedTotal}</span>
              <input name="printed_total" inputMode="decimal" dir="ltr" value={printed} onChange={(e) => setPrinted(e.target.value)} placeholder="0.00" />
            </label>
            <label className="field"><span>{t.sales.issueDate}<b className="req"> *</b></span><input type="date" name="issue_date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label className="field"><span>{t.sales.supplyDate}</span><input type="date" name="supply_date" /></label>
            {p?.government && (
              <label className="field"><span>{t.sales.paymentOrderDate}</span><input type="date" name="payment_order_date" /></label>
            )}
          </div>
          <p className="muted small">{t.sales.printedHint}</p>
          {match === true && <p className="alert ok">✓ {t.sales.totalOk}</p>}
          {match === false && <p className="alert warn">{t.sales.totalMismatch}: <span className="num">{fmt(printedN!)}</span> ≠ <span className="num">{fmt(c.invoiceTotal)}</span></p>}
          <label className="field"><span>{t.sales.notes}</span><input name="notes" /></label>
        </fieldset>

        {state.error && <p className="alert error">{state.error}</p>}
        <div className="actions wrap">
          <input type="hidden" name="intent" defaultValue="submit" />
          <button className="btn primary" data-act="submit" onClick={(e) => setIntent(e, "submit")} disabled={pending || c.error === "release"}>{t.sales.saveSubmit}</button>
          <button className="btn soft" data-act="draft" onClick={(e) => setIntent(e, "draft")} disabled={pending}>{t.sales.saveDraft}</button>
          <Link href="/sales" className="btn ghost">{t.form.cancel}</Link>
        </div>
      </div>

      <aside className="form-side">
        <div className="card preview">
          <h3>{t.sales.calc}</h3>
          <dl>
            <Row k={valueLabel} v={toNum(work)} />
            {type === "progress_claim" && <Row k={t.form.recovery} v={-c.recovery} />}
            {type !== "retention_release" && toNum(discount) > 0 && <Row k={t.sales.discount} v={-toNum(discount)} />}
            {type !== "retention_release" && <Row k={t.form.vatBase} v={c.vatBase} strong />}
            {type !== "retention_release" && <Row k={t.form.vat} v={c.vat} />}
            <Row k={t.sales.invoiceTotal} v={c.invoiceTotal} strong />
            {type === "progress_claim" && <Row k={t.form.retention} v={-c.retention} />}
            <Row k={t.form.due} v={c.due} strong accent />
            <Row k={t.form.netDue} v={c.netDue} />
            {p && p.partnerShare > 0 && <Row k={t.form.partnerShare} v={share} accent />}
          </dl>
          <p className="muted small">{t.sar}</p>
        </div>
      </aside>
    </form>
  );
}

// set before the submit event fires (state would update too late)
function setIntent(e: React.MouseEvent<HTMLButtonElement>, v: string) {
  const el = e.currentTarget.form?.elements.namedItem("intent");
  if (el instanceof HTMLInputElement) el.value = v;
}

function Row({ k, v, strong, accent }: { k: string; v: number; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`row ${strong ? "strong" : ""} ${accent ? "accent" : ""}`}>
      <dt>{k}</dt>
      <dd className="num">{v < 0 ? `(${fmt(-v)})` : fmt(v)}</dd>
    </div>
  );
}
