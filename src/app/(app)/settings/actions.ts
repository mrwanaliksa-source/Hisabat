"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (error: { message: string } | null) => {
  revalidatePath("/settings"); revalidatePath("/custody");
  redirect(`/settings${error ? `?err=${encodeURIComponent(error.message)}` : "?ok=1"}`);
};

export async function addMember(fd: FormData) {
  const { supabase, company } = await getContext();
  if (!company) return;
  const { error } = await supabase.rpc("add_member", { p_company: company.id, p_email: s(fd, "email"), p_role: s(fd, "role") });
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
    .update({ custody_approver_1: a1, custody_approver_2: a2, vat_period: s(fd, "vat_period") || "quarterly" })
    .eq("id", company.id);
  back(error);
}
