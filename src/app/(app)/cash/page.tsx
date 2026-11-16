import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

export default async function CashPage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: receipts }, { data: partners }, { data: parties }, { data: projects }, { data: held }] = await Promise.all([
    supabase.from("v_receipt_balances").select("*").eq("company_id", company.id).order("receipt_date", { ascending: false }).limit(100),
    supabase.from("v_partner_balances").select("*").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).in("kind", ["customer", "partner"]),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
    supabase.from("v_partner_project_accounts").select("*").eq("company_id", company.id).order("code"),
  ]);
  const pn = new Map((parties ?? []).map((p) => [p.id, (lang === "en" && p.name_en) || p.name_ar]));
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.cash.title}</h1>
        <Link href="/cash/receipt/new" className="btn primary"><Icon name="in" /> {t.cash.newReceipt}</Link>
      </div>
      {sp.ok && <p className="alert ok">✓</p>}

      <section className="card">
        <h2>{t.cash.receipts}</h2>
        {receipts && receipts.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.cash.date}</th><th>{t.cash.customer}</th><th>{t.cash.reference}</th>
                <th className="n">{t.cash.amount}</th><th className="n">{t.cash.allocated}</th><th className="n">{t.cash.unallocated}</th><th /></tr></thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="num">{r.receipt_date}</td><td>{pn.get(r.customer_id)}</td><td className="num">{r.reference ?? "—"}</td>
                    <td className="n num">{money(r.amount)}</td><td className="n num">{money(r.allocated)}</td>
                    <td className="n num">{Number(r.unallocated) > 0 ? <b className="warn-text">{money(r.unallocated)}</b> : money(0)}</td>
                    <td>{Number(r.unallocated) > 0 && (
                      <Link className="btn soft sm" href={`/cash/receipt/new?receipt=${r.id}`}>{t.cash.allocateRest}</Link>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.cash.noReceipts}</p>}
      </section>

      <section className="card">
        <h2>{t.cash.partners}</h2>
        {partners && partners.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.cash.partner}</th><th>{t.sales.project}</th><th className="n">{t.form.netDue}</th>
                <th className="n">{t.detail.entitled}</th><th className="n">{t.detail.settled}</th><th className="n">{t.cash.outstanding}</th><th /></tr></thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={`${p.partner_id}-${p.project_id}`}>
                    <td>{pn.get(p.partner_id)}</td><td className="num">{pc.get(p.project_id)}</td>
                    <td className="n num">{money(p.net_collected)}</td><td className="n num">{money(p.entitled)}</td>
                    <td className="n num">{money(p.settled)}</td><td className="n num"><b>{money(p.outstanding)}</b></td>
                    <td>{Number(p.outstanding) > 0 && (
                      <Link className="btn soft sm" href={`/cash/partner?partner=${p.partner_id}&project=${p.project_id}`}>{t.cash.pay}</Link>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.cash.noPartners}</p>}
      </section>
      {held && held.length > 0 && (
        <section className="card">
          <h2>{t.pp.heldTitle}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.sales.project}</th><th>{t.cash.partner}</th><th className="n">{t.pp.collectedByPartner}</th>
                <th className="n">{t.pp.transferred}</th><th className="n">{t.pp.partnerVat}</th><th className="n">{t.pp.netDue}</th><th /></tr></thead>
              <tbody>
                {held.map((h) => (
                  <tr key={h.project_id}>
                    <td><Link className="link num" href={`/projects/${h.project_id}`}>{h.code}</Link></td>
                    <td>{pn.get(h.partner_id)}</td>
                    <td className="n num">{money(h.collected_by_partner)}</td><td className="n num">{money(h.transferred_to_company)}</td>
                    <td className="n num">{money(h.partner_vat_due)}</td><td className="n num"><b>{money(h.net_due_to_company)}</b></td>
                    <td><Link className="btn soft sm" href={`/cash/transfer?project=${h.project_id}`}>{t.pp.transfer}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="note">{t.cash.supplierNote}</p>
    </div>
  );
}
