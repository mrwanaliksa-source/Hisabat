"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

export async function reverseReceipt(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("reverse_receipt", {
    p_receipt: String(fd.get("id")), p_reason: String(fd.get("reason") ?? "").trim(),
  });
  revalidatePath("/cash"); revalidatePath("/sales"); revalidatePath("/"); revalidatePath("/reports");
  redirect(error ? `/cash?err=${encodeURIComponent(error.message)}` : "/cash?ok=reversed");
}
