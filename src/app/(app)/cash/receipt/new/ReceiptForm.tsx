"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { saveReceipt, type FormState } from "./actions";
import { fmt, r2, toNum } from "@/lib/calc";
import type { Dict } from "@/lib/i18n";

export type OpenDoc = {
  id: string; customer: string; ref: string; date: string; type: string; project: string;
  total: number; balance: number; ratio: number; share: number; holder: string | null;
};
type Opt = { id: string; name: string };
type Props = {
  t: Dict; customers: Opt[]; banks: Opt[]; holders: Opt[]; docs: OpenDoc[]; initialCustomer: string;
  existing: { id: string; unallocated: number; date: string; reference: string | null; dest: string } | null;
};

export function ReceiptForm({ t, customers, banks, holders, docs, initialCustomer, existing }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveReceipt, {});
  const [customer, setCustomer] = useState(initialCustomer);
  const [amount, setAmount] = useState(existing ? String(existing.unallocated) : "");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [dest, setDest] = useState(existing?.dest ?? (banks[0] ? `bank:${banks[0].id}` : ""));
  const heldBy = dest.startsWith("partner:") ? dest.slice(8) : null;

  // partner-held projects can only be paid to that partner; our projects only to our bank
  const mine = useMemo(
    () => docs.filter((d) => d.customer === customer && (heldBy ? d.holder === heldBy : d.holder === null)),
    [docs, customer, heldBy]);
  const total = existing ? existing.unallocated : toNum(amount);
  const allocated = r2(mine.reduce((s, d) => s + toNum(alloc[d.id]), 0));
  const left = r2(total - allocated);
  const over = left < -0.004 || mine.some((d) => toNum(alloc[d.id]) > d.balance + 0.004);
  const estShare = r2(mine.reduce((s, d) => s + r2(r2(toNum(alloc[d.id]) * d.ratio) * d.share), 0));

  function autoAllocate() {
    let rest = total;
    const next: Record<string, string> = {};
    for (const d of mine) {
      const a = r2(Math.min(d.balance, Math.max(rest, 0)));
      next[d.id] = a > 0 ? String(a) : "";
      rest = r2(rest - a);
    }
    setAlloc(next);
  }

  return (
    <form action={action} className="stack-lg">
      {existing && <input type="hidden" name="receipt_id" value={existing.id} />}
      <fieldset className="card">
        <legend>{t.cash.receipts}</legend>
        <div className="grid-2">
          <label className="field">
            <span>{t.cash.customer}<b className="req"> *</b></span>
            <select name="customer_id" required value={customer} disabled={!!existing}
                    onChange={(e) => { setCustomer(e.target.value); setAlloc({}); }}>
              <option value="">{t.cash.chooseCustomer}</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {existing ? (
            <div className="field"><span>{t.cash.unallocated}</span><b className="num big-num">{fmt(existing.unallocated)}</b></div>
          ) : (
            <>
              <label className="field">
                <span>{t.cash.amount}<b className="req"> *</b></span>
                <input name="amount" inputMode="decimal" dir="ltr" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </label>
              <label className="field">
                <span>{t.cash.date}<b className="req"> *</b></span>
                <input type="date" name="receipt_date" required defaultValue={new Date().toISOString().slice(0, 10)} />
              </label>
              <label className="field">
                <span>{t.pp.received}<b className="req"> *</b></span>
                <select name="dest" required value={dest} onChange={(e) => { setDest(e.target.value); setAlloc({}); }}>
                  {banks.map((b) => <option key={b.id} value={`bank:${b.id}`}>{b.name}</option>)}
                  {holders.length > 0 && (
                    <optgroup label={t.pp.atPartner}>
                      {holders.map((h) => <option key={h.id} value={`partner:${h.id}`}>{t.pp.atPartner}: {h.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
              <label className="field"><span>{t.sales.notes}</span><input name="notes" /></label>
            </>
          )}
        </div>
      </fieldset>

      {customer && (
        <fieldset className="card">
          <div className="card-head">
            <legend>{t.cash.openDocs}</legend>
            {mine.length > 0 && total > 0 && <button type="button" className="btn soft sm" onClick={autoAllocate}>{t.cash.autoAllocate}</button>}
          </div>
          {holders.length > 0 && <p className="muted small">{t.pp.receivedHint}</p>}
          {mine.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t.sales.issuerRef}</th><th>{t.sales.docType}</th><th>{t.sales.project}</th><th>{t.sales.issueDate}</th>
                  <th className="n">{t.form.due}</th><th className="n">{t.sales.balance}</th><th className="n">{t.cash.allocate}</th></tr></thead>
                <tbody>
                  {mine.map((d) => (
                    <tr key={d.id}>
                      <td className="num">{d.ref}</td><td>{d.type}</td><td className="num">{d.project}</td><td className="num">{d.date}</td>
                      <td className="n num">{fmt(d.total)}</td><td className="n num">{fmt(d.balance)}</td>
                      <td className="n">
                        <input type="hidden" name="alloc_doc" value={d.id} />
                        <input className="cell-input" name="alloc_amount" inputMode="decimal" dir="ltr" placeholder="0.00"
                               value={alloc[d.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [d.id]: e.target.value })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">{t.cash.noOpenDocs}</p>}

          <dl className="kv narrow">
            <div><dt>{t.cash.allocated}</dt><dd className="num">{fmt(allocated)}</dd></div>
            <div className={left > 0.004 ? "hl" : ""}><dt>{t.cash.remaining}</dt><dd className="num">{fmt(left)}</dd></div>
            {estShare > 0 && <div><dt>{t.cash.estShare}</dt><dd className="num">{fmt(estShare)}</dd></div>}
          </dl>
          {left > 0.004 && <p className="note">{t.cash.unallocNote}</p>}
          {over && <p className="alert error">{t.cash.overAllocated}</p>}
        </fieldset>
      )}

      {state.error && <p className="alert error">{state.error}</p>}
      <div className="actions">
        <button className="btn primary" disabled={pending || over || !customer}>{pending ? t.cash.saving : t.cash.save}</button>
        <Link href="/cash" className="btn ghost">{t.form.cancel}</Link>
      </div>
    </form>
  );
}
