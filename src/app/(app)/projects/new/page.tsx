import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { ProjectForm } from "./ProjectForm";

export default async function NewProjectPage() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/projects");

  const { data: parties } = await supabase
    .from("parties").select("id,kind,name_ar,name_en").eq("company_id", company.id)
    .in("kind", ["customer", "partner"]).order("name_ar");
  const label = (p: { name_ar: string; name_en: string | null }) => (lang === "en" && p.name_en) || p.name_ar;
  const customers = (parties ?? []).filter((p) => p.kind === "customer").map((p) => ({ id: p.id, name: label(p) }));
  const partners = (parties ?? []).filter((p) => p.kind === "partner").map((p) => ({ id: p.id, name: label(p) }));

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.newProject}</h1>
      <ProjectForm t={t.form} sar={t.sar} customers={customers} partners={partners} lang={lang} />
    </div>
  );
}
