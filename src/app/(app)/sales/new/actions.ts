"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export type FormState = { error?: string };
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const TYPES = ["advance", "progress_claim", "retention_release", "other"];

export async function createSalesDoc(_prev: FormState, fd: FormData): Promise<FormState> {
  const { supabase, company, user } = await getContext();
  if (!company) return { error: "No company" };

  const projectId = str(fd.get("project_id"));
  const docType = str(fd.get("doc_type"));
  if (!projectId) return { error: "اختر المشروع / Choose a project" };
  if (!TYPES.includes(docType)) return { error: "Invalid document type" };
  const work = toNum(fd.get("work_value"));
  if (work <= 0) return { error: "المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero" };

  const { data: project } = await supabase.from("projects").select("id,customer_id").eq("id", projectId).eq("company_id", company.id).maybeSingle();
  if (!project?.customer_id) return { error: "المشروع بدون عميل / Project has no customer" };

  const printed = str(fd.get("printed_total"));
  const { data, error } = await supabase.from("sales_documents").insert({
    company_id: company.id,
    project_id: project.id,
    customer_id: project.customer_id,
    doc_type: docType,
    issuer_ref: str(fd.get("issuer_ref")) || null,
    issue_date: str(fd.get("issue_date")) || new Date().toISOString().slice(0, 10),
    supply_date: str(fd.get("supply_date")) || null,
    payment_order_date: str(fd.get("payment_order_date")) || null,
    work_value: work,
    discount: toNum(fd.get("discount")),
    printed_total: printed === "" ? null : toNum(printed),
    notes: str(fd.get("notes")) || null,
    created_by: user.id,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { error: "رقم الفاتورة مسجل من قبل / This invoice number is already recorded" };
    return { error: error.message };
  }

  if (fd.get("intent") === "submit") {
    const { error: e2 } = await supabase.rpc("submit_sales_document", { p_doc: data.id });
    if (e2) redirect(`/sales/${data.id}?err=${encodeURIComponent(e2.message)}`);
  }
  revalidatePath("/sales");
  redirect(`/sales/${data.id}`);
}
