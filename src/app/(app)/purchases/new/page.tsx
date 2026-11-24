import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { ExpenseForm, type Initial } from "./ExpenseForm";

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ edit?: string; commitment?: string }> }) {
  const { edit, commitment } = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!["admin", "reviewer", "expense"].includes(role ?? "")) redirect("/");

  const [{ data: projects }, { data: banks }, { data: suppliers }, { data: advs }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,name_en,group_id,contract_holder,holder:parties!projects_holder_partner_id_fkey(name_ar)").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("accounts").select("id,code,name_ar,name_en,project_id").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("parties").select("name_ar,vat_number").eq("company_id", company.id).eq("kind", "supplier").order("name_ar").limit(500),
    supabase.from("v_supplier_advance_pool").select("supplier_id,supplier_name,balance,payments").eq("company_id", company.id).order("oldest"),
  ]);
  const { data: commits } = await supabase.from("v_supplier_commitments").select("id,supplier_name,title,remaining,project_id")
    .eq("company_id", company.id).is("closed_at", null).order("created_at");
  const label = (x: { name_ar: string; name_en: string | null }) => (lang === "en" && x.name_en) || x.name_ar;

  // edit an existing expense (admin)
  let initial: Initial | undefined;
  if (edit && role === "admin") {
    const { data: d } = await supabase.from("purchase_documents").select("*, supplier:parties!purchase_documents_supplier_id_fkey(name_ar,vat_number)").eq("id", edit).maybeSingle();
    if (d) {
      const { data: pays } = await supabase.from("supplier_payments").select("id,bank_account_id,advance_id,journal_entry_id").eq("purchase_document_id", edit);
      const { data: accs } = await supabase.from("accounts").select("id,is_bank,system_key").eq("company_id", company.id);
      const acc = new Map((accs ?? []).map((a) => [a.id, a]));
      const p0 = pays?.[0];
      let pay = "credit"; let custodyLabel: string | undefined; let extWho: string | undefined; let extLoan: boolean | undefined;
      if (p0?.advance_id) pay = `advance:${d.supplier_id}`;
      else if (p0 && acc.get(p0.bank_account_id)?.is_bank) pay = `account:${p0.bank_account_id}`;
      else if (p0 && acc.get(p0.bank_account_id)?.system_key === "partner_held_cash") {
        const { data: ln } = await supabase.from("journal_lines").select("project_id").eq("entry_id", p0.journal_entry_id).eq("account_id", p0.bank_account_id).maybeSingle();
        pay = `partner:${ln?.project_id ?? d.project_id}`;
      } else if (p0 && ["loans_payable", "equity"].includes(acc.get(p0.bank_account_id)?.system_key ?? "")) {
        pay = "external"; extLoan = acc.get(p0.bank_account_id)?.system_key === "loans_payable";
        const { data: ef } = await supabase.from("external_funds").select("counterparty").eq("supplier_payment_id", p0.id).maybeSingle();
        extWho = ef?.counterparty ?? "";
      } else if (p0 && acc.get(p0.bank_account_id)?.system_key === "custody" && d.custody_id) {
        pay = `custody:${d.custody_id}`;
        const { data: cu } = await supabase.from("v_custody").select("holder_name,purpose").eq("id", d.custody_id).maybeSingle();
        custodyLabel = `${t.nav.custody}: ${cu?.holder_name ?? ""} — ${cu?.purpose ?? ""}`;
      }
      const sup = d.supplier as unknown as { name_ar: string; vat_number: string | null } | null;
      initial = { id: d.id, details: d.details ?? "", projectId: d.project_id ?? "", date: d.issue_date, supplier: sup?.name_ar ?? "",
        vatNo: sup?.vat_number ?? "", docNumber: d.doc_number?.startsWith("NA-") ? "" : d.doc_number ?? "", net: String(d.net_amount),
        noVat: Number(d.vat_amount) === 0, pay, commitmentId: d.commitment_id ?? "", custodyLabel, extWho, extLoan };
    }
  }
  const { data: ext } = await supabase.from("external_funds").select("counterparty").eq("company_id", company.id).not("counterparty", "is", null).limit(500);
  const payers = [...new Set((ext ?? []).map((x) => x.counterparty as string))];
  return (
    <div className="stack-lg">
      <h1 className="page-title">{initial ? t.exp.edit : t.exp.new}</h1>
      <ExpenseForm t={t} companyId={company.id} initial={initial} payers={payers} presetCm={initial ? undefined : commitment}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${label(p)}`, code: p.code, group: p.group_id ?? p.id,
          partner: p.contract_holder === "partner" ? ((p.holder as unknown as { name_ar: string } | null)?.name_ar ?? "") : undefined }))}
        banks={(banks ?? []).map((b) => ({ id: b.id, name: `${b.code} · ${label(b)}`, projectId: b.project_id }))}
        suppliers={(suppliers ?? []).map((s) => ({ name: s.name_ar, vat: s.vat_number ?? "" }))}
        commitments={(commits ?? []).map((c) => ({ id: c.id, supplier: c.supplier_name, title: c.title, remaining: Number(c.remaining), projectId: c.project_id }))}
        advances={(advs ?? []).map((a) => ({ id: a.supplier_id, supplier: a.supplier_name, balance: Number(a.balance), projectId: null, count: Number(a.payments) }))} />
    </div>
  );
}
