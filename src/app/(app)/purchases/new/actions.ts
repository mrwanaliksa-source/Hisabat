"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export type FormState = { error?: string };
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

// where the part of the invoice above the supplier's advances is paid from
const restOf = (v: string) =>
  v.startsWith("account:") ? { rest_mode: "account", rest_account_id: v.slice(8) }
  : v.startsWith("partner:") ? { rest_mode: "partner", rest_partner_project_id: v.slice(8) }
  : { rest_mode: "credit" };

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
  const editId = str(fd.get("edit_id"));
  if (editId) {
    const mode = pay.startsWith("partner:") ? "partner" : pay.startsWith("advance:") ? "advance" : pay.startsWith("custody:") ? "custody" : pay === "credit" ? "credit" : "account";
    const { data: newId, error: e2 } = await supabase.rpc("replace_expense", {
      p_doc: editId, p_company: company.id,
      p: { ...payload, mode, reason: str(fd.get("reason")), commitment_id: str(fd.get("commitment_id")),
           partner_project_id: mode === "partner" ? pay.slice(8) : "", supplier_id: mode === "advance" ? pay.slice(8) : "",
           custody_id: mode === "custody" ? pay.slice(8) : "", partner_reclaims_vat: fd.get("partner_reclaims_vat") === "1",
           ...(mode === "advance" ? restOf(str(fd.get("rest_pay"))) : {}) },
    });
    if (e2) return { error: e2.message };
    revalidatePath("/purchases"); revalidatePath("/");
    redirect(`/purchases/${newId}?ok=edited`);
  }
  const { data, error } = pay.startsWith("partner:")
    ? await supabase.rpc("post_expense_by_partner", { p_company: company.id, p: { ...payload, partner_project_id: pay.slice(8), partner_reclaims_vat: fd.get("partner_reclaims_vat") === "1" } })
    : pay.startsWith("advance:")
    ? await supabase.rpc("post_expense_from_advances", { p_company: company.id, p: { ...payload, supplier_id: pay.slice(8), ...restOf(str(fd.get("rest_pay"))) } })
    : await supabase.rpc("post_expense", { p_company: company.id, p: payload });
  if (error) return { error: error.message };
  const cm = str(fd.get("commitment_id"));
  if (cm) {
    const r = await supabase.rpc("link_to_commitment", { p_doc: data, p_commitment: cm });
    if (r.error) return { error: r.error.message };
  }
  revalidatePath("/purchases"); revalidatePath("/");
  redirect(`/purchases/${data}?ok=1`);
}
