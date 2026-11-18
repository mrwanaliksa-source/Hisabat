"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveExternal(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("record_external", {
    p_company: company.id,
    p: { kind: s(fd, "kind"), account_id: s(fd, "account"), amount: String(toNum(fd.get("amount"))), fund_date: s(fd, "date"),
         project_id: s(fd, "project"), counterparty: s(fd, "who"), reference: s(fd, "reference"), notes: s(fd, "notes") },
  });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/external");
  redirect(`/cash/external${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
}

export async function deleteExternal(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("delete_external", { p_id: s(fd, "id"), p_reason: s(fd, "reason") });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/external");
  redirect(`/cash/external${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=deleted"}`);
}
