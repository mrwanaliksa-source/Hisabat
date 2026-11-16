"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { toNum } from "@/lib/calc";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const frac = (fd: FormData, k: string) => (s(fd, k) === "" ? "" : String(toNum(fd.get(k)) / 100));
const num = (fd: FormData, k: string) => (s(fd, k) === "" ? "" : String(toNum(fd.get(k))));

export async function saveProject(fd: FormData) {
  const { supabase } = await getContext();
  const id = s(fd, "id");
  const { error } = await supabase.rpc("update_project", {
    p_project: id,
    p: {
      name_ar: s(fd, "name_ar"), name_en: s(fd, "name_en"), contract_value: num(fd, "contract_value"),
      start_date: s(fd, "start_date"), end_date: s(fd, "end_date"), manager_name: s(fd, "manager_name"),
      budget: num(fd, "budget"), status: s(fd, "status"),
      advance_pct: frac(fd, "advance_pct"), recovery_pct: frac(fd, "recovery_pct"),
      retention_pct: frac(fd, "retention_pct"), retention_cap_pct: frac(fd, "retention_cap_pct"),
      retention_release_terms: s(fd, "retention_release_terms"),
    },
  });
  if (error) redirect(`/projects/${id}/edit?err=${encodeURIComponent(error.message)}`);
  revalidatePath(`/projects/${id}`); revalidatePath("/projects"); revalidatePath("/");
  redirect(`/projects/${id}?ok=edit`);
}

export async function savePartner(fd: FormData) {
  const { supabase } = await getContext();
  const id = s(fd, "id");
  const { error } = await supabase.rpc("update_partner_terms", {
    p_project: id,
    p: {
      partner_id: s(fd, "partner_id"), partner_name: s(fd, "partner_name"), share_pct: frac(fd, "share_pct"),
      basis: s(fd, "basis"), contract_holder: s(fd, "contract_holder"), effective_from: s(fd, "effective_from"),
      partner_vat_period: s(fd, "partner_vat_period"),
    },
  });
  if (error) redirect(`/projects/${id}/edit?err=${encodeURIComponent(error.message)}#partner`);
  revalidatePath(`/projects/${id}`); revalidatePath("/projects"); revalidatePath("/"); revalidatePath("/sales/new");
  redirect(`/projects/${id}?ok=edit`);
}

export async function saveGroup(fd: FormData) {
  const { supabase } = await getContext();
  const id = s(fd, "id");
  const { error } = await supabase.rpc("set_project_group", { p_project: id, p_main: s(fd, "main") || null });
  if (error) redirect(`/projects/${id}/edit?err=${encodeURIComponent(error.message)}#group`);
  revalidatePath(`/projects/${id}`); revalidatePath("/");
  redirect(`/projects/${id}?ok=edit`);
}
