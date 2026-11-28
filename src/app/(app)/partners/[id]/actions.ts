"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

export async function setVatPeriod(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("set_partner_vat_period", { p_partner: id, p_period: String(fd.get("period")) });
  revalidatePath(`/partners/${id}`); revalidatePath("/reports/vat"); revalidatePath("/reports/partner-month");
  redirect(`/partners/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
}
