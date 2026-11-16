"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export async function saveAdvance(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const { error } = await supabase.rpc("pay_supplier_advance", {
    p_company: company.id,
    p: {
      supplier_name: s("supplier_name"), project_id: s("project_id"), pay_date: s("pay_date"),
      amount: String(toNum(fd.get("amount"))), account_id: s("account_id"), reference: s("reference"), notes: s("notes"),
    },
  });
  if (error) redirect(`/purchases/advance/new?err=${encodeURIComponent(error.message)}`);
  revalidatePath("/purchases"); revalidatePath("/"); revalidatePath("/cash");
  redirect("/purchases?ok=advance");
}
