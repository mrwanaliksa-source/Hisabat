"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

export async function deleteAdvance(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("delete_supplier_advance", { p_advance: id, p_reason: String(fd.get("reason") ?? "") });
  if (error) redirect(`/purchases/advance/${id}?err=${encodeURIComponent(error.message)}`);
  revalidatePath("/purchases"); revalidatePath("/"); revalidatePath("/cash");
  redirect("/purchases?ok=advDeleted");
}
