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
