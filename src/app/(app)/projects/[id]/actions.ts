"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

export async function projectAction(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const what = String(fd.get("what"));
  const date = String(fd.get("date") || new Date().toISOString().slice(0, 10));
  const { error } = what === "close"
    ? await supabase.rpc("close_project", { p_project: id, p_date: date })
    : await supabase.rpc("reopen_project", { p_project: id, p_date: date });
  revalidatePath(`/projects/${id}`); revalidatePath("/projects"); revalidatePath("/"); revalidatePath("/cash");
  redirect(`/projects/${id}${error ? `?err=${encodeURIComponent(error.message)}` : `?ok=${what}`}`);
}

export async function adjustOpening(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id") ?? "");
  const actual = Number(String(fd.get("actual") ?? "").replace(/,/g, ""));
  const { error } = await supabase.rpc("adjust_opening_cash", {
    p_project: id, p_actual: actual, p_date: String(fd.get("date") ?? "") || null, p_reason: String(fd.get("reason") ?? ""),
  });
  revalidatePath(`/projects/${id}`); revalidatePath("/"); revalidatePath("/cash");
  redirect(`/projects/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=opening"}`);
}

export async function settleParts(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id") ?? "");
  const g = (k: string) => String(fd.get(k) ?? "");
  const { error } = await supabase.rpc("settle_inter_part", {
    p_debtor: g("debtor"), p_creditor: g("creditor"), p_amount: Number(g("amount").replace(/,/g, "")),
    p_from_account: g("from_account"), p_to_account: g("to_account"), p_date: g("date") || null,
  });
  revalidatePath(`/projects/${id}`); revalidatePath("/"); revalidatePath("/cash");
  redirect(`/projects/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=parts"}#parts`);
}
