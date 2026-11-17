"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { createExpense, type FormState } from "./actions";
import { fmt, r2, toNum } from "@/lib/calc";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Dict } from "@/lib/i18n";

type Opt = { id: string; name: string; code?: string; group?: string; projectId?: string | null; partner?: string };
type Adv = { id: string; supplier: string; balance: number; projectId: string | null; count?: number };
type Cm = { id: string; supplier: string; title: string; remaining: number; projectId: string | null };
export type Initial = { id: string; details: string; projectId: string; date: string; supplier: string; vatNo: string; docNumber: string;
  net: string; noVat: boolean; pay: string; commitmentId: string; custodyLabel?: string };
type Props = { t: Dict; commitments: Cm[]; initial?: Initial; companyId: string; projects: Opt[]; banks: Opt[]; suppliers: { name: string; vat: string }[]; advances: Adv[] };

const validVat = (v: string) => /^3\d{13}3$/.test(v.replace(/\D/g, ""));

export function ExpenseForm({ t, companyId, projects, banks, suppliers, advances, commitments, initial }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(createExpense, {});
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? (projects.length === 1 ? projects[0].id : ""));
  const [vatNo, setVatNo] = useState(initial?.vatNo ?? "");
  const [net, setNet] = useState(initial?.net ?? "");
  const [noVat, setNoVat] = useState(initial?.noVat ?? false);
  const [cmId, setCmId] = useState(initial?.commitmentId ?? "");
  const cm = commitments.find((c) => c.id === cmId) ?? null;
  const defPay = banks[1] ? `account:${banks[1].id}` : banks[0] ? `account:${banks[0].id}` : "credit";
  const [pay, setPay] = useState(initial?.pay ?? defPay);
  const adv = pay.startsWith("advance:") ? advances.find((a) => a.id === pay.slice(8)) ?? null : null;
  const [photo, setPhoto] = useState<{ path: string; hash: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  // VAT is always 15% of the net amount unless the invoice has no VAT
  const vat = noVat ? 0 : r2(toNum(net) * 0.15);
  const total = r2(toNum(net) + vat);
  const deductible = vat > 0 && validVat(vatNo);

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
      {initial && (
        <fieldset className="card">
          <legend>{t.exp.editing}</legend>
          <input type="hidden" name="edit_id" value={initial.id} />
          <p className="alert warn small">{t.exp.editNote}</p>
          <label className="field"><span>{t.exp.reason}<b className="req"> *</b></span><input name="reason" required /></label>
        </fieldset>
      )}
      <fieldset className="card">
        <legend>{t.exp.details}</legend>
        <label className="field">
          <span>{t.exp.details}<b className="req"> *</b></span>
          <textarea name="details" required rows={3} placeholder={t.exp.detailsHint} defaultValue={initial?.details} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t.exp.project}</span>
            <select name="project_id" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{t.exp.general}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t.exp.date}<b className="req"> *</b></span>
            <input type="date" name="issue_date" required defaultValue={initial?.date ?? new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="field">
            <span>{t.exp.supplier}<b className="req"> *</b></span>
            <input name="supplier_name" required list="suppliers" value={adv ? adv.supplier : cm ? cm.supplier : supplier} readOnly={!!adv || !!cm} className={adv || cm ? "computed" : undefined} onChange={(e) => onSupplier(e.target.value)} />
            <datalist id="suppliers">{suppliers.map((s) => <option key={s.name} value={s.name} />)}</datalist>
          </label>
          <label className="field">
            <span>{t.exp.supplierVat}</span>
            <input name="supplier_vat" dir="ltr" inputMode="numeric" maxLength={15} value={vatNo} onChange={(e) => setVatNo(e.target.value)} />
          </label>
          {commitments.length > 0 && (
            <label className="field">
              <span>{t.cm.on}</span>
              <select name="commitment_id" value={cmId} onChange={(e) => { setCmId(e.target.value); const c = commitments.find((x) => x.id === e.target.value); if (c?.projectId) setProjectId(c.projectId); }}>
                <option value="">{t.cm.noneOpt}</option>
                {commitments.map((c) => <option key={c.id} value={c.id}>{c.supplier} — {c.title} — {t.cm.remaining} {fmt(c.remaining)}</option>)}
              </select>
              {cm && <small className="muted">{t.cm.remaining} {t.cm.after}: <b className="num">{fmt(r2(cm.remaining - total))}</b></small>}
            </label>
          )}
          <label className="field">
            <span>{t.exp.docNumber}</span>
            <input name="doc_number" dir="ltr" defaultValue={initial?.docNumber} />
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
            <span>{t.exp.vat} <small className="muted">{noVat ? "" : t.exp.vatAuto}</small></span>
            <input inputMode="decimal" dir="ltr" value={fmt(vat)} readOnly className="computed" tabIndex={-1} />
            <input type="hidden" name="vat_amount" value={vat} />
          </label>
          <label className="field">
            <span>{t.exp.total}</span>
            <input dir="ltr" value={fmt(total)} readOnly className="computed strong" tabIndex={-1} />
            <input type="hidden" name="total_amount" value={total} />
          </label>
        </div>
        <label className="check"><input type="checkbox" checked={noVat} onChange={(e) => setNoVat(e.target.checked)} /> {t.exp.noVat}</label>
        {toNum(vat) > 0 && <p className={`alert ${deductible ? "ok" : "warn"}`}>{deductible ? t.exp.vatDeductible : t.exp.vatNotDeductible}</p>}
      </fieldset>

      <fieldset className="card">
        <legend>{t.exp.payment}</legend>
        <label className="field">
          <span>{t.exp.payAccount}</span>
          <select name="pay" value={pay} onChange={(e) => setPay(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={`account:${b.id}`}>{b.name}{b.projectId ? ` — ${t.parts.moneyOf} ${projects.find((p) => p.id === b.projectId)?.code ?? ""}` : ""}</option>)}
            <option value="credit">{t.exp.payCredit}</option>
            {initial?.pay.startsWith("custody:") && <option value={initial.pay}>{initial.custodyLabel}</option>}
            {projects.some((p) => p.partner !== undefined) && (
              <optgroup label={t.exp.byPartner}>
                {projects.filter((p) => p.partner !== undefined).map((p) => (
                  <option key={p.id} value={`partner:${p.id}`}>{t.exp.byPartner}: {p.partner} — {t.parts.moneyOf} {p.code}</option>
                ))}
              </optgroup>
            )}
            {advances.length > 0 && (
              <optgroup label={t.adv.payFrom}>
                {advances.map((a) => <option key={a.id} value={`advance:${a.id}`}>{a.supplier} — {a.count && a.count > 1 ? `${a.count} ${t.adv.payments} · ` : ""}{t.adv.left} {fmt(a.balance)}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {pay.startsWith("partner:") && vat > 0 && (
          <label className="check"><input type="checkbox" name="partner_reclaims_vat" value="1" defaultChecked /> {t.exp.partnerReclaims}</label>
        )}
        {(() => {
          // money of one part spent on another part's works → loan note
          const bank = pay.startsWith("account:") ? banks.find((b) => b.id === pay.slice(8)) : null;
          const fundId = pay.startsWith("partner:") ? pay.slice(8) : bank?.projectId;
          const works = projects.find((p) => p.id === projectId), funding = projects.find((p) => p.id === fundId);
          if (!works || !funding || works.id === funding.id || works.group !== funding.group) return null;
          return <p className="alert warn small">{t.parts.loanNote.replace("{works}", works.code ?? "").replace("{funding}", funding.code ?? "")}</p>;
        })()}
        {adv && (
          <p className="alert ok small">
            {t.adv.payFrom}: <b className="num">{fmt(Math.min(total, adv.balance))}</b>
          </p>
        )}
        {adv && total > adv.balance && (
          <label className="field">
            <span>{t.adv.restFrom.replace("{amount}", fmt(r2(total - adv.balance)))}</span>
            <select name="rest_pay" defaultValue="credit">
              <option value="credit">{t.exp.payCredit}</option>
              {banks.map((b) => <option key={b.id} value={`account:${b.id}`}>{b.name}{b.projectId ? ` — ${t.parts.moneyOf} ${projects.find((p) => p.id === b.projectId)?.code ?? ""}` : ""}</option>)}
              {projects.filter((p) => p.partner !== undefined).map((p) => <option key={p.id} value={`partner:${p.id}`}>{t.exp.byPartner}: {p.partner} — {t.parts.moneyOf} {p.code}</option>)}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t.exp.photo}</span>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={onPhoto} />
        </label>
        {uploading && <p className="muted small">{t.exp.uploading}</p>}
        {uploadErr && <p className="alert error">{uploadErr}</p>}
        {photo && <p className="alert ok">✓</p>}
        <input type="hidden" name="attachment_path" value={photo?.path ?? ""} />
        <input type="hidden" name="file_hash" value={photo?.hash ?? ""} />
        {adv && <input type="hidden" name="advance_supplier" value={adv.id} />}
      </fieldset>

      {state.error && <p className="alert error">{state.error}</p>}
      <div className="actions">
        <button className="btn primary" data-act="save" disabled={pending || uploading}>{pending ? t.exp.saving : t.exp.save}</button>
        <Link href="/purchases" className="btn ghost">{t.form.cancel}</Link>
      </div>
    </form>
  );
}
