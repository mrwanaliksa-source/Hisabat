import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { saveTransfer } from "./actions";

type SP = Promise<{ project?: string; err?: string }>;

export default async function PartnerTransfer({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role) || !sp.project) redirect("/cash");

  const [{ data: acct }, { data: banks }, { data: moves }] = await Promise.all([
    supabase.from("v_partner_project_accounts").select("*").eq("project_id", sp.project).maybeSingle(),
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("partner_transfers").select("id,transfer_date,direction,amount,reference").eq("project_id", sp.project).order("transfer_date"),
  ]);
  if (!acct) redirect(`/projects/${sp.project}`);
  const { data: partner } = await supabase.from("parties").select("name_ar,name_en").eq("id", acct.partner_id).maybeSingle();
  const nm = (x: { name_ar: string; name_en: string | null } | null) => (x ? (lang === "en" && x.name_en) || x.name_ar : "—");
  const dirLabel = { to_company: t.pp.toCompany, to_partner: t.pp.toPartner, partner_paid_vat: t.pp.paidVat } as Record<string, string>;

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

      <div className="grid-2 top">
        <form action={saveTransfer} className="card stack">
          <input type="hidden" name="project" value={sp.project} />
          <dl className="kv">
            <div><dt>{t.pp.held}</dt><dd className="num">{money(acct.held_by_partner)}</dd></div>
            <div><dt>{t.pp.partnerVat}</dt><dd className="num">{money(acct.partner_vat_due)}</dd></div>
            <div className="hl"><dt>{t.pp.netDue}</dt><dd className="num">{money(acct.net_due_to_company)}</dd></div>
          </dl>
          <label className="field"><span>{t.pp.direction}</span>
            <select name="direction" defaultValue="to_company">
              <option value="to_company">{t.pp.toCompany}</option>
              <option value="to_partner">{t.pp.toPartner}</option>
              <option value="partner_paid_vat">{t.pp.paidVat}</option>
            </select></label>
          <label className="field"><span>{t.cash.payAmount}</span>
            <input name="amount" inputMode="decimal" dir="ltr" required placeholder="0.00" /></label>
          <label className="field"><span>{t.cash.date}</span>
            <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label className="field"><span>{t.cash.bank}</span>
            <select name="bank">{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {nm(b)}</option>)}</select></label>
          <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
          <button className="btn primary" data-act="transfer">{t.pp.save}</button>
        </form>

        <section className="card">
          <h2>{t.pp.account}</h2>
          {moves && moves.length > 0 ? (
            <table>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{m.transfer_date}</td><td>{dirLabel[m.direction]}</td>
                    <td className="num">{m.reference ?? ""}</td><td className="n num">{money(m.amount)}</td>
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
