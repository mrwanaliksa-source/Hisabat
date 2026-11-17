import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money, pct } from "@/lib/i18n";
import { ReportHeader } from "@/components/ReportHeader";

export default async function PartnersReport() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: agreements }, { data: bal }, { data: held }, { data: projects }, { data: parties }] = await Promise.all([
    supabase.from("partner_agreements").select("project_id,partner_id,share_pct,basis").eq("company_id", company.id),
    supabase.from("v_partner_balances").select("*").eq("company_id", company.id),
    supabase.from("v_partner_project_accounts").select("*").eq("company_id", company.id),
    supabase.from("projects").select("id,code,name_ar,status,close_profit,close_share").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).eq("kind", "partner"),
  ]);
  const pr = new Map((projects ?? []).map((p) => [p.id, p]));
  const b = new Map((bal ?? []).map((x) => [`${x.partner_id}|${x.project_id}`, x]));
  const h = new Map((held ?? []).map((x) => [x.project_id, x]));

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.partners.t} desc={t.rep.partners.d} name="partners" />
      {(parties ?? []).filter((p) => agreements?.some((a) => a.partner_id === p.id)).map((p) => {
        const rows = (agreements ?? []).filter((a) => a.partner_id === p.id);
        return (
          <section key={p.id} className="card">
            <h2><Link className="link" href={`/partners/${p.id}`}>{(lang === "en" && p.name_en) || p.name_ar}</Link></h2>
            <div className="table-wrap"><table>
              <thead><tr><th>{t.sales.project}</th><th>{t.pp.basis}</th><th className="n">%</th>
                <th className="n">{t.detail.entitled}</th><th className="n">{t.detail.settled}</th><th className="n">{t.detail.outstanding}</th>
                <th className="n">{t.pp.collectedByPartner}</th><th className="n">{t.pp.transferred}</th><th className="n">{t.pp.netDue}</th></tr></thead>
              <tbody>{rows.map((a) => {
                const proj = pr.get(a.project_id); const x = b.get(`${p.id}|${a.project_id}`); const y = h.get(a.project_id);
                const profitBased = a.basis === "profit_at_close";
                return (
                  <tr key={a.project_id}>
                    <td><Link className="link num" href={`/projects/${a.project_id}`}>{proj?.code}</Link> {proj?.name_ar}</td>
                    <td className="small">{profitBased ? t.pp.basisProfit : t.pp.basisCollections}{proj?.status === "closed" ? ` · ${t.pp.closed}` : ""}</td>
                    <td className="n num">{pct(a.share_pct)}</td>
                    <td className="n num">{profitBased ? money(proj?.close_share ?? 0) : money(x?.entitled)}</td>
                    <td className="n num">{profitBased ? "—" : money(x?.settled)}</td>
                    <td className="n num">{profitBased ? "—" : <b>{money(x?.outstanding)}</b>}</td>
                    <td className="n num">{y ? money(y.collected_by_partner) : "—"}</td>
                    <td className="n num">{y ? money(y.transferred_to_company) : "—"}</td>
                    <td className="n num">{y ? <b>{money(y.net_due_to_company)}</b> : "—"}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          </section>
        );
      })}
      {!(agreements ?? []).length && <section className="card"><p className="muted">{t.rep.none}</p></section>}
    </div>
  );
}
