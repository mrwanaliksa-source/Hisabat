import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

// opens the invoice photo with a fresh short-lived link (the storage bucket is private)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, company } = await getContext();
  const back = new URL(`/purchases/${id}`, req.url);
  if (!company) return NextResponse.redirect(back);
  const { data: d } = await supabase.from("purchase_documents").select("attachment_path").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!d?.attachment_path) return NextResponse.redirect(back);
  const { data } = await supabase.storage.from("attachments").createSignedUrl(d.attachment_path, 300);
  return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : NextResponse.redirect(back);
}
