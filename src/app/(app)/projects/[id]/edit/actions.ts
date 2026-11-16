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
