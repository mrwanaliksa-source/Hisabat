"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export async function payPartner(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const { error } = await supabase.rpc("record_partner_settlement", {
    p_company: company.id, p_partner: s("partner"), p_project: s("project") || null, p_date: s("date"),
    p_amount: toNum(fd.get("amount")), p_bank_account: s("bank"), p_reference: s("reference") || null,
  });
  if (error) redirect(`/cash/partner?partner=${s("partner")}&project=${s("project")}&err=${encodeURIComponent(error.message)}`);
  revalidatePath("/cash"); revalidatePath("/");
  redirect("/cash?ok=partner");
}
