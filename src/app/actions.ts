"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

const YEAR = 60 * 60 * 24 * 365;

export async function setLanguage(formData: FormData) {
  const lang = formData.get("lang") === "en" ? "en" : "ar";
  (await cookies()).set("lang", lang, { path: "/", maxAge: YEAR, sameSite: "lax" });
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) await supabase.from("profiles").update({ language: lang }).eq("id", user.id);
  revalidatePath("/", "layout");
}

export async function setCompany(formData: FormData) {
  const id = String(formData.get("company") ?? "");
  (await cookies()).set("company", id, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  (await cookies()).delete("company");   // next login asks again which company
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
