import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import type { ProjectTerms } from "@/lib/calc";
import { SalesForm } from "./SalesForm";

export default async function NewSalesDoc({ searchParams }: { searchParams: Promise<{ project?: string; type?: string; value?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company } = await getContext();
  if (!company) return null;

  const [{ data: projects }, { data: bal }, { data: partners }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,name_en,contract_value,recovery_pct,retention_pct,retention_cap_pct,retention_vat_mode,customer:parties!projects_customer_id_fkey(name_ar,name_en,is_government)")
      .eq("company_id", company.id).in("status", ["active", "on_hold", "completed", "closed"]).order("code"),
    supabase.from("v_project_advance_retention").select("project_id,advance_outstanding,retention_held,retention_outstanding").eq("company_id", company.id),
    supabase.from("partner_agreements").select("project_id,share_pct,effective_to,basis").eq("company_id", company.id),
  ]);
  const b = new Map((bal ?? []).map((x) => [x.project_id, x]));
  const share = new Map((partners ?? []).filter((p) => !p.effective_to && p.basis === "collections").map((p) => [p.project_id, Number(p.share_pct)]));
  type C = { name_ar: string; name_en: string | null; is_government: boolean } | null;

  const opts = (projects ?? []).map((p) => {
    const x = b.get(p.id);
    const c = p.customer as unknown as C;
    const terms: ProjectTerms = {
      id: p.id, contract_value: Number(p.contract_value), recovery_pct: Number(p.recovery_pct), retention_pct: Number(p.retention_pct),
      retention_cap_pct: p.retention_cap_pct == null ? null : Number(p.retention_cap_pct),
      advance_outstanding: Number(x?.advance_outstanding ?? 0), retention_held: Number(x?.retention_held ?? 0),
      retention_outstanding: Number(x?.retention_outstanding ?? 0),
      vat_mode: p.retention_vat_mode === "B" ? "B" : "A",
    };
    return {
      terms, label: `${p.code} · ${(lang === "en" && p.name_en) || p.name_ar}`,
      customer: c ? (lang === "en" && c.name_en) || c.name_ar : "—", government: !!c?.is_government,
      partnerShare: share.get(p.id) ?? 0,
    };
  });

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.sales.newDoc}</h1>
      <SalesForm t={t} projects={opts} initialProject={sp.project ?? ""} initialType={sp.type ?? "progress_claim"} initialValue={sp.value} />
    </div>
  );
}
