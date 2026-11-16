"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createExpense, type FormState } from "./actions";
import { fmt, r2, toNum } from "@/lib/calc";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Dict } from "@/lib/i18n";

type Opt = { id: string; name: string };
type Props = { t: Dict; companyId: string; projects: Opt[]; banks: Opt[]; suppliers: { name: string; vat: string }[] };

const validVat = (v: string) => /^3\d{13}3$/.test(v.replace(/\D/g, ""));

export function ExpenseForm({ t, companyId, projects, banks, suppliers }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createExpense, {});
  const [supplier, setSupplier] = useState("");
  const [vatNo, setVatNo] = useState("");
  const [net, setNet] = useState("");
  const [vat, setVat] = useState("");
  const [total, setTotal] = useState("");
  const [totalTouched, setTotalTouched] = useState(false);
  const [photo, setPhoto] = useState<{ path: string; hash: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const sum = r2(toNum(net) + toNum(vat));
  const totalShown = totalTouched ? total : sum ? String(sum) : "";
  const mismatch = totalTouched && total !== "" && Math.abs(toNum(total) - sum) > 0.05;
  const deductible = toNum(vat) > 0 && validVat(vatNo);

  function onSupplier(v: string) {
    setSupplier(v);
    const hit = suppliers.find((s) => s.name === v);
    if (hit?.vat && !vatNo) setVatNo(hit.vat);
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setUploadErr("");
    if (!f) { setPhoto(null); return; }
    setUploading(true);
    try {
      const buf = await f.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${companyId}/expenses/${hash.slice(0, 16)}-${Date.now()}.${ext}`;
      const { error } = await supabaseBrowser().storage.from("attachments").upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      setPhoto({ path, hash });
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err));
      setPhoto(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={action} className="stack-lg narrow-form">
      <fieldset className="card">
        <legend>{t.exp.details}</legend>
        <label className="field">
          <span>{t.exp.details}<b className="req"> *</b></span>
          <textarea name="details" required rows={3} placeholder={t.exp.detailsHint} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t.exp.project}</span>
            <select name="project_id" defaultValue={projects.length === 1 ? projects[0].id : ""}>
              <option value="">{t.exp.general}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t.exp.date}<b className="req"> *</b></span>
            <input type="date" name="issue_date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="field">
            <span>{t.exp.supplier}<b className="req"> *</b></span>
            <input name="supplier_name" required list="suppliers" value={supplier} onChange={(e) => onSupplier(e.target.value)} />
            <datalist id="suppliers">{suppliers.map((s) => <option key={s.name} value={s.name} />)}</datalist>
          </label>
          <label className="field">
            <span>{t.exp.supplierVat}</span>
            <input name="supplier_vat" dir="ltr" inputMode="numeric" maxLength={15} value={vatNo} onChange={(e) => setVatNo(e.target.value)} />
          </label>
          <label className="field">
            <span>{t.exp.docNumber}</span>
            <input name="doc_number" dir="ltr" />
          </label>
        </div>
      </fieldset>

      <fieldset className="card">
        <legend>{t.exp.total}</legend>
        <div className="grid-3">
          <label className="field">
            <span>{t.exp.net}<b className="req"> *</b></span>
            <input name="net_amount" inputMode="decimal" dir="ltr" required value={net} onChange={(e) => setNet(e.target.value)} placeholder="0.00" />
          </label>
          <label className="field">
            <span>{t.exp.vat}
              <button type="button" className="link-btn" onClick={() => setVat(String(r2(toNum(net) * 0.15)))}>{t.exp.addVat}</button>
            </span>
            <input name="vat_amount" inputMode="decimal" dir="ltr" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="0.00" />
          </label>
          <label className="field">
            <span>{t.exp.total}</span>
            <input name="total_amount" inputMode="decimal" dir="ltr" value={totalShown}
                   onChange={(e) => { setTotalTouched(true); setTotal(e.target.value); }} placeholder="0.00" />
          </label>
        </div>
        {mismatch && <p className="alert warn">{t.exp.totalsMismatch}: <span className="num">{fmt(sum)}</span></p>}
        {toNum(vat) > 0 && <p className={`alert ${deductible ? "ok" : "warn"}`}>{deductible ? t.exp.vatDeductible : t.exp.vatNotDeductible}</p>}
      </fieldset>

      <fieldset className="card">
        <legend>{t.exp.payment}</legend>
        <label className="field">
          <span>{t.exp.payAccount}</span>
          <select name="pay" defaultValue={banks[1] ? `account:${banks[1].id}` : banks[0] ? `account:${banks[0].id}` : "credit"}>
            {banks.map((b) => <option key={b.id} value={`account:${b.id}`}>{b.name}</option>)}
            <option value="credit">{t.exp.payCredit}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.exp.photo}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onPhoto} />
        </label>
        {uploading && <p className="muted small">{t.exp.uploading}</p>}
        {uploadErr && <p className="alert error">{uploadErr}</p>}
        {photo && <p className="alert ok">✓</p>}
        <input type="hidden" name="attachment_path" value={photo?.path ?? ""} />
        <input type="hidden" name="file_hash" value={photo?.hash ?? ""} />
      </fieldset>

      {state.error && <p className="alert error">{state.error}</p>}
      <div className="actions">
        <button className="btn primary" data-act="save" disabled={pending || uploading || mismatch}>{pending ? t.exp.saving : t.exp.save}</button>
        <Link href="/purchases" className="btn ghost">{t.form.cancel}</Link>
      </div>
    </form>
  );
}
