"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const done = (path: string, error: { message: string } | null, ok = "1") => {
  revalidatePath("/custody"); revalidatePath("/purchases"); revalidatePath("/");
  redirect(`${path}${error ? `?err=${encodeURIComponent(error.message)}` : `?ok=${ok}`}`);
};

export async function requestCustody(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { data, error } = await supabase.rpc("request_custody", {
    p_company: company.id, p_amount: toNum(fd.get("amount")), p_purpose: s(fd, "purpose"), p_project: s(fd, "project") || null,
  });
  if (error) done("/custody", error);
  done(`/custody/${data}`, null, "sent");
}

export async function openCustody(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const src = s(fd, "source");
  const { data, error } = await supabase.rpc("open_custody", {
    p_company: company.id,
    p: { holder: s(fd, "holder"), amount: String(toNum(fd.get("amount"))), purpose: s(fd, "purpose"), project_id: s(fd, "project"),
         date: s(fd, "date"), source: src === "external" ? "external" : "account", account_id: src.startsWith("account:") ? src.slice(8) : "",
         ext_who: s(fd, "ext_who"), ext_loan: fd.get("ext_loan") === "1" },
  });
  revalidatePath("/cash/external");
  if (error) done("/custody", error);
  done(`/custody/${data}`, null, "opened");
}

export async function decideCustody(fd: FormData) {
  const { supabase } = await getContext();
  const id = s(fd, "id");
  const { error } = s(fd, "what") === "reject"
    ? await supabase.rpc("reject_custody", { p_custody: id, p_reason: s(fd, "reason") })
    : await supabase.rpc("approve_custody", { p_custody: id, p_account: s(fd, "account") || null, p_date: s(fd, "date") || new Date().toISOString().slice(0, 10) });
  done(`/custody/${id}`, error, s(fd, "what"));
}

export type SettleState = { error?: string };
export async function settleCustody(_prev: SettleState, fd: FormData): Promise<SettleState> {
  const { supabase } = await getContext();
  const id = s(fd, "id");
  const invoices = JSON.parse(s(fd, "invoices") || "[]");
  const { error } = await supabase.rpc("settle_custody", {
    p_custody: id, p_invoices: invoices, p_return_amount: toNum(fd.get("return_amount")),
    p_return_account: s(fd, "return_account") || null, p_date: s(fd, "date") || new Date().toISOString().slice(0, 10),
  });
  if (error) return { error: error.message };
  done(`/custody/${id}`, null, "settled");
  return {};
}
