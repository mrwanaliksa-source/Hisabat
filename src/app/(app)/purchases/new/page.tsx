import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { ExpenseForm } from "./ExpenseForm";

export default async function NewExpense() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!["admin", "reviewer", "expense"].includes(role ?? "")) redirect("/");

  const [{ data: projects }, { data: banks }, { data: suppliers }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,name_en").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("parties").select("name_ar,vat_number").eq("company_id", company.id).eq("kind", "supplier").order("name_ar").limit(500),
  ]);
  const label = (x: { name_ar: string; name_en: string | null }) => (lang === "en" && x.name_en) || x.name_ar;
  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.exp.new}</h1>
      <ExpenseForm t={t} companyId={company.id}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${label(p)}` }))}
        banks={(banks ?? []).map((b) => ({ id: b.id, name: `${b.code} · ${label(b)}` }))}
        suppliers={(suppliers ?? []).map((s) => ({ name: s.name_ar, vat: s.vat_number ?? "" }))} />
    </div>
  );
}
