"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loginEmail, validUsername } from "@/lib/username";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** accepts "mdc", "MDC" or a pasted link like ".../login?c=MDC" → "mdc" */
const slugOf = (v: string) => {
  const m = v.match(/[?&]c=([^&#]+)/);
  return (m ? m[1] : v.split("/").filter(Boolean).pop() ?? "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
};
const back = (error: { message: string } | null) => {
  revalidatePath("/settings"); revalidatePath("/custody");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
};

export async function addMember(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("add_member", { p_company: company.id, p_email: loginEmail(s(fd, "email")), p_role: s(fd, "role") });
  back(error);
}

export async function updateMember(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("set_member", {
    p_company: company.id, p_user: s(fd, "user"), p_role: s(fd, "role"), p_active: s(fd, "active") === "true",
  });
  back(error);
}

export async function saveCompany(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const a1 = s(fd, "approver_1") || null, a2 = s(fd, "approver_2") || null;
  if (a1 && a1 === a2) back({ message: "المدير الأول والثاني يجب أن يكونا شخصين مختلفين / Approvers must be different people" });
  const { error } = await supabase.from("companies")
    .update({ custody_approver_1: a1, custody_approver_2: a2, vat_period: s(fd, "vat_period") || "quarterly",
              ...(slugOf(s(fd, "slug")) ? { slug: slugOf(s(fd, "slug")) } : {}) })
    .eq("id", company.id);
  back(error);
}

const ROLES = ["admin", "reviewer", "entry", "expense", "custody"];

/** Creates a login (username + password) and adds it to the company. Admin only. */
export async function createUser(fd: FormData) {
  const { supabase, company, role } = await getContext();
  if (!company || role !== "admin") back({ message: "Permission denied" });
  const admin = supabaseAdmin();
  if (!admin) back({ message: "SUPABASE_SERVICE_ROLE_KEY is not set in Netlify" });

  const username = s(fd, "username").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const fullName = s(fd, "full_name");
  const newRole = s(fd, "role");
  if (!validUsername(username)) back({ message: "اسم المستخدم غير صالح: حروف إنجليزية صغيرة وأرقام فقط / Invalid username" });
  if (password.length < 8) back({ message: "كلمة المرور 8 أحرف على الأقل / Password must be at least 8 characters" });
  if (!ROLES.includes(newRole)) back({ message: "Invalid role" });

  const { error: e1 } = await admin!.auth.admin.createUser({
    email: loginEmail(username), password, email_confirm: true,
    user_metadata: { full_name: fullName || username, username },
  });
  if (e1) back({ message: /already|registered|exists/i.test(e1.message)
    ? "اسم المستخدم مستخدم من قبل / Username already exists" : e1.message });

  // membership is added as the signed-in admin, through the normal permission checks
  const { error: e2 } = await supabase!.rpc("add_member", { p_company: company!.id, p_email: loginEmail(username), p_role: newRole });
  back(e2);
}

/** Sets a new password for a member of this company. Admin only. */
export async function resetPassword(fd: FormData) {
  const { supabase, company, role } = await getContext();
  if (!company || role !== "admin") back({ message: "Permission denied" });
  const admin = supabaseAdmin();
  if (!admin) back({ message: "SUPABASE_SERVICE_ROLE_KEY is not set in Netlify" });
  const userId = s(fd, "user");
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) back({ message: "كلمة المرور 8 أحرف على الأقل / Password must be at least 8 characters" });
  // only members of the admin's own company
  const { data: m } = await supabase!.from("memberships").select("user_id").eq("company_id", company!.id).eq("user_id", userId).maybeSingle();
  if (!m) back({ message: "User is not a member of this company" });
  const { error } = await admin!.auth.admin.updateUserById(userId, { password });
  back(error);
}

export async function addCompany(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("create_company_v2", {
    p: { name_ar: s(fd, "name_ar"), name_en: s(fd, "name_en"), slug: slugOf(s(fd, "slug")), vat_number: s(fd, "vat_number"), cr_number: s(fd, "cr_number") },
  });
  revalidatePath("/", "layout");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=company"}#companies`);
}

export async function saveAccess(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("set_access", { p_company: s(fd, "company"), p_user: s(fd, "user"), p_role: s(fd, "role") });
  revalidatePath("/settings");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=access"}#access`);
}

export async function addBank(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("add_bank_account", { p_company: company.id, p_name: s(fd, "name"), p_project: s(fd, "project") || null });
  revalidatePath("/", "layout");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}#banks`);
}

export async function linkBank(fd: FormData) {
  const { supabase } = await getContext();
  const { error } = await supabase.rpc("set_account_project", { p_account: s(fd, "account"), p_project: s(fd, "project") || null });
  revalidatePath("/", "layout");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}#banks`);
}
