import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { saveProject } from "./actions";

const pct = (v: unknown) => (v == null ? "" : String(Math.round(Number(v) * 10000) / 100));

export default async function EditProject({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const t = dict(await getLang());
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect(`/projects/${id}`);

  const { data: p } = await supabase.from("projects").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!p) notFound();
  const { count } = await supabase.from("sales_documents").select("id", { count: "exact", head: true })
    .eq("project_id", id).eq("status", "posted").in("doc_type", ["progress_claim", "retention_release"]);
  const locked = (count ?? 0) > 0;
  const F = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;

  return (
    <div className="stack-lg narrow-form">
      <div className="page-head">
        <div><p className="eyebrow num">{p.code}</p><h1 className="page-title">{t.detail.edit}</h1></div>
        <Link href={`/projects/${id}`} className="btn ghost">{t.form.cancel}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}

      <form action={saveProject} className="stack-lg">
        <input type="hidden" name="id" value={id} />
        <fieldset className="card">
          <legend>{t.form.basics}</legend>
          <div className="grid-2">
            <F label={t.form.nameAr}><input name="name_ar" required defaultValue={p.name_ar} /></F>
            <F label={t.form.nameEn}><input name="name_en" dir="ltr" defaultValue={p.name_en ?? ""} /></F>
            <F label={t.form.contractValue}><input name="contract_value" dir="ltr" inputMode="decimal" defaultValue={p.contract_value} readOnly={locked} className={locked ? "computed" : ""} /></F>
            <F label={t.form.budget}><input name="budget" dir="ltr" inputMode="decimal" defaultValue={p.budget ?? ""} /></F>
            <F label={t.form.startDate}><input type="date" name="start_date" defaultValue={p.start_date ?? ""} /></F>
            <F label={t.form.endDate}><input type="date" name="end_date" defaultValue={p.end_date ?? ""} /></F>
            <F label={t.form.manager}><input name="manager_name" defaultValue={p.manager_name ?? ""} /></F>
            <F label={t.col.status}>
              <select name="status" defaultValue={p.status === "closed" ? "closed" : p.status} disabled={p.status === "closed"}>
                {(["active", "on_hold", "completed"] as const).map((k) => <option key={k} value={k}>{t.status[k]}</option>)}
                {p.status === "closed" && <option value="closed">{t.status.closed}</option>}
              </select>
            </F>
          </div>
        </fieldset>

        <fieldset className="card">
          <legend>{t.form.terms}</legend>
          {locked && <p className="alert warn">{t.detail.locked}</p>}
          <div className="grid-2">
            <F label={t.form.advancePct}><input name="advance_pct" dir="ltr" inputMode="decimal" defaultValue={pct(p.advance_pct)} readOnly={locked} className={locked ? "computed" : ""} /></F>
            <F label={t.form.recoveryPct}><input name="recovery_pct" dir="ltr" inputMode="decimal" defaultValue={pct(p.recovery_pct)} readOnly={locked} className={locked ? "computed" : ""} /></F>
            <F label={t.form.retentionPct}><input name="retention_pct" dir="ltr" inputMode="decimal" defaultValue={pct(p.retention_pct)} readOnly={locked} className={locked ? "computed" : ""} /></F>
            <F label={t.form.retentionCap}><input name="retention_cap_pct" dir="ltr" inputMode="decimal" defaultValue={pct(p.retention_cap_pct)} readOnly={locked} className={locked ? "computed" : ""} /></F>
          </div>
          <F label={t.form.releaseTerms}><input name="retention_release_terms" defaultValue={p.retention_release_terms ?? ""} placeholder={t.form.releaseHint} /></F>
          <p className="muted small">{t.detail.advanceNote}</p>
          <p className="note">{t.form.vatNote}</p>
        </fieldset>

        <button className="btn primary self-start" data-act="save">{t.detail.save}</button>
      </form>
    </div>
  );
}
