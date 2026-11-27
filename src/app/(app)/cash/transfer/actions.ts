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
  // money put in the partner's own (tracked) bank is booked like a transfer in, to that bank
  const direction = s("direction") === "to_partner_bank" ? "to_company" : s("direction");
  const { error } = await supabase.rpc("record_partner_transfer", {
    p_company: company.id, p_project: project, p_date: s("date"), p_amount: toNum(fd.get("amount")),
    p_direction: direction, p_bank_account: ["to_company", "to_partner"].includes(direction) ? s("bank") || null : null,
    p_reference: s("reference") || null,
  });
  if (error) redirect(`/cash/transfer?project=${project}&err=${encodeURIComponent(error.message)}`);
  revalidatePath("/cash"); revalidatePath(`/projects/${project}`); revalidatePath("/");
  redirect(`/projects/${project}?ok=transfer`);
}

export async function deleteTransfer(fd: FormData) {
  const { supabase } = await getContext();
  const project = String(fd.get("project") ?? "");
  const { error } = await supabase.rpc("delete_partner_transfer", { p_id: String(fd.get("id")), p_reason: String(fd.get("reason") ?? "") });
  revalidatePath("/cash"); revalidatePath(`/projects/${project}`); revalidatePath("/");
  redirect(`/cash/transfer?project=${project}${error ? `&err=${encodeURIComponent(error.message)}` : "&ok=deleted"}`);
}
