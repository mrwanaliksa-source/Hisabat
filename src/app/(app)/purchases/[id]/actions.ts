"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export async function paySupplier(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("pay_purchase", {
    p_doc: id, p_date: String(fd.get("date")), p_amount: toNum(fd.get("amount")),
    p_account: String(fd.get("account")), p_reference: String(fd.get("reference") ?? "") || null,
  });
  revalidatePath(`/purchases/${id}`); revalidatePath("/purchases"); revalidatePath("/");
  redirect(`/purchases/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=paid"}`);
}
