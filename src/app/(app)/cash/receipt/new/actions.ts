"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

export type FormState = { error?: string };
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();

export async function saveReceipt(_prev: FormState, fd: FormData): Promise<FormState> {
  const { supabase, company } = await getContext();
  if (!company) return { error: "No company" };

  const allocations = fd.getAll("alloc_doc").map((doc, i) => ({ doc: String(doc), amount: toNum(fd.getAll("alloc_amount")[i]) }))
    .filter((a) => a.amount > 0);
  const existing = str(fd.get("receipt_id"));

  let error;
  if (existing) {
    ({ error } = await supabase.rpc("allocate_receipt_many", { p_receipt: existing, p_allocations: allocations }));
  } else {
    const amount = toNum(fd.get("amount"));
    if (amount <= 0) return { error: "المبلغ يجب أن يكون أكبر من صفر / Amount must be greater than zero" };
    const dest = str(fd.get("dest"));
    const bank = dest.startsWith("bank:") ? dest.slice(5) : null;
    const held = dest.startsWith("partner:") ? dest.slice(8) : null;
    ({ error } = await supabase.rpc("record_receipt_with_allocations", {
      p_company: company.id, p_customer: str(fd.get("customer_id")), p_date: str(fd.get("receipt_date")),
      p_amount: amount, p_bank_account: bank, p_reference: str(fd.get("reference")) || null,
      p_notes: str(fd.get("notes")) || null, p_allocations: allocations, p_held_by: held,
    }));
  }
  if (error) return { error: error.message };
  revalidatePath("/cash"); revalidatePath("/sales"); revalidatePath("/");
  redirect("/cash?ok=receipt");
}
