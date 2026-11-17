import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { saveAdvance } from "./actions";

export default async function NewAdvance({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!["admin", "reviewer", "expense"].includes(role ?? "")) redirect("/");

  const [{ data: projects }, { data: banks }, { data: suppliers }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,name_en,group_id").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("accounts").select("id,code,name_ar,name_en,project_id").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("parties").select("name_ar").eq("company_id", company.id).eq("kind", "supplier").order("name_ar").limit(500),
  ]);
  const label = (x: { name_ar: string; name_en: string | null }) => (lang === "en" && x.name_en) || x.name_ar;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.adv.new}</h1>
        <Link href="/purchases" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      <form action={saveAdvance} className="card stack narrow-form">
        <p className="explain small">{t.adv.explain}</p>
        <div className="grid-2">
          <label className="field"><span>{t.adv.supplier}<b className="req"> *</b></span>
            <input name="supplier_name" required list="adv-suppliers" />
            <datalist id="adv-suppliers">{(suppliers ?? []).map((s) => <option key={s.name_ar} value={s.name_ar} />)}</datalist></label>
          <label className="field"><span>{t.exp.project}</span>
            <select name="project_id" defaultValue="">
              <option value="">{t.exp.general}</option>
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {label(p)}</option>)}
            </select></label>
          <label className="field"><span>{t.adv.amount}<b className="req"> *</b></span>
            <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
          <label className="field"><span>{t.exp.date}<b className="req"> *</b></span>
            <input type="date" name="pay_date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label className="field"><span>{t.adv.paidFrom}</span>
            <select name="account_id">{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {label(b)}{b.project_id ? ` — ${t.parts.moneyOf} ${(projects ?? []).find((p) => p.id === b.project_id)?.code ?? ""}` : ""}</option>)}</select>
            <small className="muted">{t.adv.loanHint}</small></label>
          <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
        </div>
        <label className="field"><span>{t.adv.notes}<b className="req"> *</b></span>
          <input name="notes" required placeholder={t.adv.notesHint} /></label>
        <button className="btn primary self-start" data-act="save-advance">{t.adv.save}</button>
      </form>
    </div>
  );
}
