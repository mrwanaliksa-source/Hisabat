"use client";
import { useActionState, useState } from "react";
import { settleCustody, type SettleState } from "../actions";
import { fmt, r2, toNum } from "@/lib/calc";
import type { Dict } from "@/lib/i18n";

type Opt = { id: string; name: string };
type Inv = { key: number; details: string; supplier_name: string; supplier_vat: string; doc_number: string;
             issue_date: string; net_amount: string; vat_amount: string; project_id: string };
type Props = { t: Dict; custodyId: string; balance: number; defaultProject: string; projects: Opt[]; banks: Opt[];
               suppliers: { name: string; vat: string }[] };

export function SettleForm({ t, custodyId, balance, defaultProject, projects, banks, suppliers }: Props) {
  const [state, action, pending] = useActionState<SettleState, FormData>(settleCustody, {});
  const today = new Date().toISOString().slice(0, 10);
  const blank = (k: number): Inv => ({ key: k, details: "", supplier_name: "", supplier_vat: "", doc_number: "",
    issue_date: today, net_amount: "", vat_amount: "", project_id: defaultProject });
  const [rows, setRows] = useState<Inv[]>([blank(1)]);
  const [ret, setRet] = useState("");

  const set = (k: number, f: keyof Inv, v: string) => setRows(rows.map((r) => (r.key === k ? { ...r, [f]: v } : r)));
  const used = rows.filter((r) => toNum(r.net_amount) > 0);
  const totalInv = r2(used.reduce((s, r) => s + toNum(r.net_amount) + toNum(r.vat_amount), 0));
  const after = r2(balance - totalInv - toNum(ret));
  const missingDetails = used.some((r) => !r.details.trim() || !r.supplier_name.trim());
  const payload = JSON.stringify(used.map((r) => ({
    details: r.details, supplier_name: r.supplier_name, supplier_vat: r.supplier_vat, doc_number: r.doc_number,
    issue_date: r.issue_date, net_amount: String(toNum(r.net_amount)), vat_amount: String(toNum(r.vat_amount)),
    total_amount: String(r2(toNum(r.net_amount) + toNum(r.vat_amount))), project_id: r.project_id,
  })));

  return (
    <form action={action} className="card stack">
      <h2>{t.cus.settleTitle}</h2>
      <input type="hidden" name="id" value={custodyId} />
      <input type="hidden" name="invoices" value={payload} />
      <datalist id="settle-suppliers">{suppliers.map((s) => <option key={s.name} value={s.name} />)}</datalist>

      {rows.map((r, i) => (
        <fieldset key={r.key} className="invoice-row">
          <div className="row-head">
            <b className="num">#{i + 1}</b>
            {rows.length > 1 && <button type="button" className="link-btn danger" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>{t.cus.removeInvoice}</button>}
          </div>
          <label className="field"><span>{t.exp.details}<b className="req"> *</b></span>
            <input value={r.details} onChange={(e) => set(r.key, "details", e.target.value)} placeholder={t.exp.detailsHint} /></label>
          <div className="grid-3">
            <label className="field"><span>{t.exp.supplier}<b className="req"> *</b></span>
              <input list="settle-suppliers" value={r.supplier_name} onChange={(e) => {
                const hit = suppliers.find((s) => s.name === e.target.value);
                setRows(rows.map((x) => x.key === r.key ? { ...x, supplier_name: e.target.value, supplier_vat: x.supplier_vat || hit?.vat || "" } : x));
              }} /></label>
            <label className="field"><span>{t.exp.supplierVat}</span>
              <input dir="ltr" inputMode="numeric" maxLength={15} value={r.supplier_vat} onChange={(e) => set(r.key, "supplier_vat", e.target.value)} /></label>
            <label className="field"><span>{t.exp.docNumber}</span>
              <input dir="ltr" value={r.doc_number} onChange={(e) => set(r.key, "doc_number", e.target.value)} /></label>
            <label className="field"><span>{t.exp.net}<b className="req"> *</b></span>
              <input dir="ltr" inputMode="decimal" value={r.net_amount} onChange={(e) => set(r.key, "net_amount", e.target.value)} placeholder="0.00" /></label>
            <label className="field"><span>{t.exp.vat}</span>
              <input dir="ltr" inputMode="decimal" value={r.vat_amount} onChange={(e) => set(r.key, "vat_amount", e.target.value)} placeholder="0.00" /></label>
            <label className="field"><span>{t.exp.date}</span>
              <input type="date" value={r.issue_date} onChange={(e) => set(r.key, "issue_date", e.target.value)} /></label>
          </div>
          <label className="field"><span>{t.exp.project}</span>
            <select value={r.project_id} onChange={(e) => set(r.key, "project_id", e.target.value)}>
              <option value="">{t.exp.general}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
        </fieldset>
      ))}
      <button type="button" className="btn soft self-start" onClick={() => setRows([...rows, blank(Date.now())])}>{t.cus.addInvoice}</button>

      <div className="grid-2">
        <label className="field"><span>{t.cus.returnCash}</span>
          <input name="return_amount" dir="ltr" inputMode="decimal" value={ret} onChange={(e) => setRet(e.target.value)} placeholder="0.00" /></label>
        <label className="field"><span>{t.cus.returnTo}</span>
          <select name="return_account" defaultValue={banks[1]?.id ?? banks[0]?.id}>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>

      <dl className="kv narrow">
        <div><dt>{t.cus.balance}</dt><dd className="num">{fmt(balance)}</dd></div>
        <div><dt>{t.cus.invoices}</dt><dd className="num">({fmt(totalInv)})</dd></div>
        {toNum(ret) > 0 && <div><dt>{t.cus.returned}</dt><dd className="num">({fmt(toNum(ret))})</dd></div>}
        <div className={after < 0 ? "bad" : "hl"}><dt>{t.cus.afterSettle}</dt><dd className="num">{fmt(after)}</dd></div>
      </dl>

      {state.error && <p className="alert error">{state.error}</p>}
      <button className="btn primary self-start" data-act="settle"
              disabled={pending || after < -0.004 || missingDetails || (used.length === 0 && toNum(ret) <= 0)}>
        {t.cus.settleSave}
      </button>
    </form>
  );
}
