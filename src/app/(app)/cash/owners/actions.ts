"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveOwnerAdvance(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("record_owner_advance", {
    p_company: company.id,
    p: { owner_id: s(fd, "owner"), kind: s(fd, "kind"), source: s(fd, "source") === "external" ? "external" : "account",
         account_id: s(fd, "source").startsWith("account:") ? s(fd, "source").slice(8) : "", ext_who: s(fd, "ext_who"),
         ext_loan: fd.get("ext_loan") === "1", project_id: s(fd, "project"), amount: String(toNum(fd.get("amount"))),
         date: s(fd, "date"), notes: s(fd, "notes") },
  });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/owners"); revalidatePath("/cash/external");
  redirect(`/cash/owners${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
}

export async function deleteOwnerAdvance(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("delete_owner_advance", { p_id: s(fd, "id"), p_reason: s(fd, "reason") });
  revalidatePath("/cash"); revalidatePath("/"); revalidatePath("/cash/owners"); revalidatePath("/cash/external");
  redirect(`/cash/owners${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=deleted"}`);
}
