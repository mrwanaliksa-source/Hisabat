import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { TransferForm } from "./TransferForm";
import { deleteTransfer } from "./actions";

type SP = Promise<{ project?: string; err?: string; ok?: string }>;

export default async function PartnerTransfer({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role) || !sp.project) redirect("/cash");

  const [{ data: acct }, { data: banks }, { data: moves }] = await Promise.all([
    supabase.from("v_partner_project_accounts").select("*").eq("project_id", sp.project).maybeSingle(),
    supabase.from("accounts").select("id,code,name_ar,name_en,project_id").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("partner_transfers").select("id,transfer_date,direction,amount,reference,bank_account_id").eq("project_id", sp.project).order("transfer_date"),
  ]);
  if (!acct) redirect(`/projects/${sp.project}`);
  const { data: partner } = await supabase.from("parties").select("name_ar,name_en").eq("id", acct.partner_id).maybeSingle();
  const nm = (x: { name_ar: string; name_en: string | null } | null) => (x ? (lang === "en" && x.name_en) || x.name_ar : "—");
  // banks that belong to a part held by this same partner = the partner's own bank, tracked here
  const { data: held } = await supabase.from("projects").select("id").eq("company_id", company.id).eq("contract_holder", "partner").eq("holder_partner_id", acct.partner_id);
  const heldIds = new Set((held ?? []).map((p) => p.id));
  const isPartnerBank = (b: { project_id: string | null }) => !!b.project_id && heldIds.has(b.project_id);
  const bankName = new Map((banks ?? []).map((b) => [b.id, `${b.code} · ${nm(b)}`]));
  const pbank = new Set((banks ?? []).filter(isPartnerBank).map((b) => b.id));
  const dirLabel = { to_company: t.pp.toCompany, to_partner: t.pp.toPartner, partner_paid_vat: t.pp.paidVat, partner_kept_share: t.pp.keptShare, partner_kept_zakat: t.pp.keptZakat } as Record<string, string>;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow num">{acct.code}</p>
          <h1 className="page-title">{t.pp.transfer}: {nm(partner)}</h1>
        </div>
        <Link href={`/projects/${sp.project}`} className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok === "deleted" && <p className="alert ok">✓ {t.mv.deleted}</p>}

      <div className="grid-2 top">
        <TransferForm t={t} project={sp.project}
          ours={(banks ?? []).filter((b) => !isPartnerBank(b)).map((b) => ({ id: b.id, name: bankName.get(b.id) ?? "" }))}
          partnerBanks={(banks ?? []).filter(isPartnerBank).map((b) => ({ id: b.id, name: bankName.get(b.id) ?? "" }))}
          kv={<dl className="kv">
            <div><dt>{t.pp.held}</dt><dd className="num">{money(acct.held_by_partner)}</dd></div>
            <div><dt>{t.pp.partnerVat}</dt><dd className="num">{money(acct.partner_vat_due)}</dd></div>
            <div className="hl"><dt>{t.pp.netDue}</dt><dd className="num">{money(acct.net_due_to_company)}</dd></div>
          </dl>} />

        <section className="card">
          <h2>{t.pp.account}</h2>
          {moves && moves.length > 0 ? (
            <table>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{m.transfer_date}</td><td>{m.direction === "to_company" && m.bank_account_id && pbank.has(m.bank_account_id) ? t.pp.toPartnerBank : dirLabel[m.direction]}
                      {m.bank_account_id && <span className="muted small"> — {t.pp.inBank} {bankName.get(m.bank_account_id)}</span>}</td>
                    <td className="num">{m.reference ?? ""}</td><td className="n num">{money(m.amount)}</td>
                    {role === "admin" && <td>
                      <form action={deleteTransfer} className="inline-form">
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="project" value={sp.project} />
                        <input name="reason" required placeholder={t.exp.reason} className="pw-input" />
                        <button className="btn ghost sm danger" data-act="delete-transfer">✕</button>
                      </form></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">—</p>}
        </section>
      </div>
    </div>
  );
}
