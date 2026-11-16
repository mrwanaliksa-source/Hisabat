"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export type FormState = { error?: string };
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function createExpense(_prev: FormState, fd: FormData): Promise<FormState> {
  const { supabase, company } = await getContext();
  if (!company) return { error: "No company" };
  const pay = str(fd.get("pay"));
  const payload = {
    project_id: str(fd.get("project_id")),
    supplier_name: str(fd.get("supplier_name")),
    supplier_vat: str(fd.get("supplier_vat")),
    doc_number: str(fd.get("doc_number")),
    issue_date: str(fd.get("issue_date")),
    net_amount: String(toNum(fd.get("net_amount"))),
    vat_amount: String(toNum(fd.get("vat_amount"))),
    total_amount: String(toNum(fd.get("total_amount"))),
    details: str(fd.get("details")),
    payment: pay === "credit" ? "credit" : "account",
    account_id: pay.startsWith("account:") ? pay.slice(8) : "",
    attachment_path: str(fd.get("attachment_path")),
    file_hash: str(fd.get("file_hash")),
  };
  const { data, error } = pay.startsWith("partner:")
    ? await supabase.rpc("post_expense_by_partner", { p_company: company.id, p: { ...payload, partner_project_id: pay.slice(8), partner_reclaims_vat: fd.get("partner_reclaims_vat") === "1" } })
    : pay.startsWith("advance:")
    ? await supabase.rpc("post_expense_from_advance", { p_company: company.id, p: { ...payload, advance_id: pay.slice(8) } })
    : await supabase.rpc("post_expense", { p_company: company.id, p: payload });
  if (error) return { error: error.message };
  revalidatePath("/purchases"); revalidatePath("/");
  redirect(`/purchases/${data}?ok=1`);
}
