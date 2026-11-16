import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";

export type Role = "admin" | "reviewer" | "entry";
export type Company = { id: string; name_ar: string; name_en: string | null };

/** Signed-in user, their companies, and the active company (cookie or first). */
export async function getContext() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rows } = await supabase
    .from("memberships")
    .select("role, company:companies(id, name_ar, name_en)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const memberships = (rows ?? [])
    .filter((r) => r.company)
    .map((r) => ({ role: r.role as Role, company: r.company as unknown as Company }));

  const wanted = (await cookies()).get("company")?.value;
  const active = memberships.find((m) => m.company.id === wanted) ?? memberships[0] ?? null;

  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();

  return {
    supabase,
    user,
    displayName: profile?.full_name || user.email || "",
    memberships,
    company: active?.company ?? null,
    role: active?.role ?? null,
  };
}

export function canManage(role: Role | null) {
  return role === "admin" || role === "reviewer";
}
