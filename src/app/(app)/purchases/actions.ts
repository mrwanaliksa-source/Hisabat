"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addCommitment(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("add_commitment", {
    p_company: company.id,
    p: { supplier_name: s(fd, "supplier_name"), title: s(fd, "title"), total_amount: String(toNum(fd.get("total_amount"))), project_id: s(fd, "project_id") },
  });
  revalidatePath("/purchases");
  redirect(`/purchases${error ? `?err=${encodeURIComponent(error.message)}` : ""}#commitments`);
}

export async function toggleCommitment(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("close_commitment", { p_commitment: s(fd, "id"), p_close: s(fd, "close") === "1" });
  revalidatePath("/purchases");
  redirect(`/purchases${error ? `?err=${encodeURIComponent(error.message)}` : ""}#commitments`);
}
