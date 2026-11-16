"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export async function saveTransfer(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const project = s("project");
  const direction = s("direction");
  const { error } = await supabase.rpc("record_partner_transfer", {
    p_company: company.id, p_project: project, p_date: s("date"), p_amount: toNum(fd.get("amount")),
    p_direction: direction, p_bank_account: direction === "partner_paid_vat" ? null : s("bank") || null,
    p_reference: s("reference") || null,
  });
  if (error) redirect(`/cash/transfer?project=${project}&err=${encodeURIComponent(error.message)}`);
  revalidatePath("/cash"); revalidatePath(`/projects/${project}`); revalidatePath("/");
  redirect(`/projects/${project}?ok=transfer`);
}
