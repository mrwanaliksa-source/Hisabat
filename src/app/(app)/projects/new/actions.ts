"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, canManage } from "@/lib/context";

export type FormState = { error?: string };

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
  return s === "" ? "" : s;
};
const frac = (v: FormDataEntryValue | null) => {
  const s = num(v);
  return s === "" ? "" : String(Number(s) / 100);
};
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function createProject(_prev: FormState, fd: FormData): Promise<FormState> {
  const { supabase, company, role } = await getContext();
  if (!company || !canManage(role)) return { error: "Permission denied" };

  const holder = fd.get("contract_holder") === "partner" ? "partner" : "company";
  const hasPartner = holder === "partner" || fd.get("has_partner") === "on";
  const payload = {
    code: str(fd.get("code")),
    name_ar: str(fd.get("name_ar")),
    name_en: str(fd.get("name_en")),
    customer_id: str(fd.get("customer_id")),
    customer_name: str(fd.get("customer_name")),
    customer_vat: str(fd.get("customer_vat")),
    customer_is_government: fd.get("customer_is_government") === "on",
    contract_value: num(fd.get("contract_value")),
    start_date: str(fd.get("start_date")),
    end_date: str(fd.get("end_date")),
    manager_name: str(fd.get("manager_name")),
    budget: num(fd.get("budget")),
    advance_pct: frac(fd.get("advance_pct")),
    recovery_pct: frac(fd.get("recovery_pct")),
    retention_pct: frac(fd.get("retention_pct")),
    retention_cap_pct: frac(fd.get("retention_cap_pct")),
    retention_release_terms: str(fd.get("retention_release_terms")),
    has_partner: hasPartner,
    partner_id: hasPartner ? str(fd.get("partner_id")) : "",
    partner_name: hasPartner ? str(fd.get("partner_name")) : "",
    share_pct: hasPartner ? frac(fd.get("share_pct")) : "",
    partner_from: hasPartner ? str(fd.get("partner_from")) : "",
    contract_holder: holder,
    basis: hasPartner ? str(fd.get("basis")) : "",
    partner_vat_period: holder === "partner" ? str(fd.get("partner_vat_period")) : "",
  };

  const { data, error } = await supabase.rpc("create_project", { p_company: company.id, p: payload });
  if (error) return { error: error.message };
  revalidatePath("/projects");
  redirect(`/projects/${data}`);
}
