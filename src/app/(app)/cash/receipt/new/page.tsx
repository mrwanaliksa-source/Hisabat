import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { ReceiptForm, type OpenDoc } from "./ReceiptForm";

type SP = Promise<{ customer?: string; receipt?: string }>;

export default async function NewReceipt({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: customers }, { data: banks }, { data: open }, { data: agreements }, { data: existing }] = await Promise.all([
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).eq("kind", "customer").order("name_ar"),
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("v_sales_document_balances").select("id,customer_id,project_id,doc_type,issuer_ref,issue_date,collectible_total,balance")
      .eq("company_id", company.id).eq("status", "posted").gt("balance", 0).order("issue_date"),
    supabase.from("partner_agreements").select("project_id,share_pct,effective_to,basis").eq("company_id", company.id),
    sp.receipt ? supabase.from("v_receipt_balances").select("*").eq("id", sp.receipt).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const docIds = (open ?? []).map((d) => d.id);
  const [{ data: nets }, { data: projs }] = await Promise.all([
    docIds.length ? supabase.from("sales_documents").select("id,collectible_net").in("id", docIds) : Promise.resolve({ data: [] }),
    supabase.from("projects").select("id,code,contract_holder,holder_partner_id").eq("company_id", company.id),
  ]);
  const net = new Map((nets ?? []).map((x) => [x.id, Number(x.collectible_net)]));
  const code = new Map((projs ?? []).map((p) => [p.id, p.code]));
  const share = new Map((agreements ?? []).filter((a) => !a.effective_to && a.basis === "collections").map((a) => [a.project_id, Number(a.share_pct)]));
  const holder = new Map((projs ?? []).map((p) => [p.id, p.holder_partner_id as string | null]));
  const holderIds = [...new Set((projs ?? []).map((p) => p.holder_partner_id).filter(Boolean))] as string[];
  const { data: holders } = holderIds.length
    ? await supabase.from("parties").select("id,name_ar,name_en").in("id", holderIds)
    : { data: [] as { id: string; name_ar: string; name_en: string | null }[] };

  const docs: OpenDoc[] = (open ?? []).map((d) => ({
    id: d.id, customer: d.customer_id, ref: d.issuer_ref ?? "—", date: d.issue_date,
    type: t.docType[d.doc_type as keyof typeof t.docType], project: code.get(d.project_id) ?? "",
    total: Number(d.collectible_total), balance: Number(d.balance),
    ratio: Number(d.collectible_total) > 0 ? (net.get(d.id) ?? 0) / Number(d.collectible_total) : 0,
    share: share.get(d.project_id) ?? 0,
    holder: holder.get(d.project_id) ?? null,
  }));

  const label = (p: { name_ar: string; name_en: string | null }) => (lang === "en" && p.name_en) || p.name_ar;
  let existingDest = "";
  if (existing) {
    const { data: rr } = await supabase.from("receipts").select("bank_account_id,held_by_partner").eq("id", existing.id).maybeSingle();
    existingDest = rr?.held_by_partner ? `partner:${rr.held_by_partner}` : `bank:${rr?.bank_account_id}`;
  }
  return (
    <div className="stack-lg">
      <h1 className="page-title">{existing ? t.cash.allocateRest : t.cash.newReceipt}</h1>
      <ReceiptForm
        t={t}
        customers={(customers ?? []).map((c) => ({ id: c.id, name: label(c) }))}
        banks={(banks ?? []).map((b) => ({ id: b.id, name: `${b.code} · ${label(b)}` }))}
        holders={(holders ?? []).map((h) => ({ id: h.id, name: label(h) }))}
        docs={docs}
        initialCustomer={existing?.customer_id ?? sp.customer ?? ""}
        existing={existing ? { id: existing.id, unallocated: Number(existing.unallocated), date: existing.receipt_date, reference: existing.reference,
          dest: existingDest } : null}
      />
    </div>
  );
}
