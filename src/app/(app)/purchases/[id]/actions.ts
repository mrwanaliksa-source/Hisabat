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

export async function applyAdvance(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("apply_supplier_advance", {
    p_doc: id, p_advance: String(fd.get("advance")), p_amount: toNum(fd.get("amount")),
    p_date: new Date().toISOString().slice(0, 10),
  });
  revalidatePath(`/purchases/${id}`); revalidatePath("/purchases"); revalidatePath("/");
  redirect(`/purchases/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=advance"}`);
}

export async function payByPartner(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("pay_purchase_by_partner", {
    p_doc: id, p_project: String(fd.get("project")), p_amount: toNum(fd.get("amount")),
    p_date: String(fd.get("date") || new Date().toISOString().slice(0, 10)), p_reference: null,
  });
  if (!error && fd.get("reclaim") === "1") {
    const r = await supabase.rpc("reclaim_vat_by_partner", { p_doc: id, p_project: String(fd.get("project")) });
    if (r.error) redirect(`/purchases/${id}?err=${encodeURIComponent(r.error.message)}`);
  }
  revalidatePath(`/purchases/${id}`); revalidatePath("/purchases"); revalidatePath("/");
  redirect(`/purchases/${id}${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=paid"}`);
}

export async function linkCommitment(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const { error } = await supabase.rpc("link_to_commitment", { p_doc: id, p_commitment: String(fd.get("commitment") || "") || null });
  revalidatePath(`/purchases/${id}`); revalidatePath("/purchases");
  redirect(`/purchases/${id}${error ? `?err=${encodeURIComponent(error.message)}` : ""}`);
}
