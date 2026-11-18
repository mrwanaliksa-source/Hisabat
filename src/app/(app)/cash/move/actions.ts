"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveMove(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("transfer_funds", {
    p_company: company.id,
    p: { from_account: s(fd, "from"), to_account: s(fd, "to"), amount: String(toNum(fd.get("amount"))), transfer_date: s(fd, "date"),
         project_id: s(fd, "project"), reference: s(fd, "reference"), notes: s(fd, "notes") },
  });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/move");
  redirect(`/cash/move${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
}

export async function deleteMove(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("delete_account_transfer", { p_id: s(fd, "id"), p_reason: s(fd, "reason") });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/move");
  redirect(`/cash/move${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=deleted"}`);
}
