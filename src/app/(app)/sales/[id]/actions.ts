"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";

const back = (id: string, q: string) => {
  revalidatePath("/sales"); revalidatePath(`/sales/${id}`); revalidatePath("/review"); revalidatePath("/");
  redirect(`/sales/${id}${q}`);
};

export async function docAction(fd: FormData) {
  const { supabase } = await getContext();
  const id = String(fd.get("id"));
  const what = String(fd.get("what"));
  const reason = String(fd.get("reason") ?? "").trim();
  let error: { message: string } | null = null;

  if (what === "submit") ({ error } = await supabase.rpc("submit_sales_document", { p_doc: id }));
  else if (what === "approve") ({ error } = await supabase.rpc("approve_sales_document", { p_doc: id }));
  else if (what === "needs_info" || what === "reject" || what === "reopen")
    ({ error } = await supabase.rpc("review_document", { p_table: "sales_documents", p_doc: id, p_action: what, p_reason: reason }));
  else if (what === "delete") {
    ({ error } = await supabase.from("sales_documents").delete().eq("id", id).eq("status", "draft"));
    if (!error) { revalidatePath("/sales"); redirect("/sales"); }
  }
  back(id, error ? `?err=${encodeURIComponent(error.message)}` : `?ok=${what}`);
}
