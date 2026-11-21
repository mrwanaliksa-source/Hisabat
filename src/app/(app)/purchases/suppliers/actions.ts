"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

export async function saveSupplier(fd: FormData) {
  const { supabase } = await getContext();
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const { error } = await supabase.rpc("update_supplier", { p_id: g("id"), p_name: g("name"), p_vat: g("vat") });
  revalidatePath("/purchases/suppliers"); revalidatePath("/purchases");
  redirect(`/purchases/suppliers${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}#s-${g("id")}`);
}
