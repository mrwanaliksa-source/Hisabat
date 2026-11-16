import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money, pct } from "@/lib/i18n";

type Params = Promise<{ id: string }>;

export default async function ProjectDetail({ params }: { params: Params }) {
  const { id } = await params;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: p } = await supabase
    .from("projects")
    .select("*, customer:parties(name_ar,name_en,is_government)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!p) notFound();

  const [{ data: bal }, { data: agreements }, { data: partnerBal }, { data: prof }, { data: docs }] = await Promise.all([
    supabase.from("v_project_advance_retention").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("partner_agreements").select("id,share_pct,effective_from,effective_to,partner:parties(name_ar,name_en)")
      .eq("project_id", id).order("effective_from"),
    manager ? supabase.from("v_partner_balances").select("*").eq("project_id", id) : Promise.resolve({ data: null }),
    manager ? supabase.from("v_project_profitability").select("*").eq("project_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("sales_documents").select("id,doc_type,issuer_ref,issue_date,status,collectible_total")
      .eq("project_id", id).order("issue_date", { ascending: false }).limit(20),
  ]);

  const name = (x: { name_ar: string; name_en: string | null } | null | undefined) =>
    x ? (lang === "en" && x.name_en) || x.name_ar : "—";
  const cust = p.customer as { name_ar: string; name_en: string | null; is_government: boolean } | null;
  const partnerTotals = (partnerBal ?? []).reduce(
    (s, r) => ({ e: s.e + Number(r.entitled), s: s.s + Number(r.settled), o: s.o + Number(r.outstanding) }),
    { e: 0, s: 0, o: 0 }
  );

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow num">{p.code}</p>
          <h1 className="page-title">{(lang === "en" && p.name_en) || p.name_ar}</h1>
          <p className="muted">{name(cust)}{cust?.is_government ? ` · ${t.form.government}` : ""}</p>
        </div>
        <Link href="/projects" className="btn ghost">{t.back}</Link>
      </div>

      <div className="grid-3">
        <section className="card">
          <h2>{t.detail.terms}</h2>
          <dl className="kv">
            <div><dt>{t.col.contract}</dt><dd className="num">{money(p.contract_value)}</dd></div>
            <div><dt>{t.form.advancePct}</dt><dd className="num">{pct(p.advance_pct)}</dd></div>
            <div><dt>{t.detail.advanceAmount}</dt><dd className="num">{money(p.advance_amount)}</dd></div>
            <div><dt>{t.form.recoveryPct}</dt><dd className="num">{pct(p.recovery_pct)}</dd></div>
            <div><dt>{t.form.retentionPct}</dt><dd className="num">{pct(p.retention_pct)}</dd></div>
            <div><dt>{t.form.retentionCap}</dt><dd className="num">{p.retention_cap_pct == null ? "—" : pct(p.retention_cap_pct)}</dd></div>
            {p.retention_release_terms && <div><dt>{t.form.releaseTerms}</dt><dd>{p.retention_release_terms}</dd></div>}
          </dl>
          <p className="note">{t.form.vatNote}</p>
        </section>

        <section className="card">
          <h2>{t.detail.balances}</h2>
          <dl className="kv">
            <div><dt>{t.col.certified}</dt><dd className="num">{money(bal?.works_certified)}</dd></div>
            <div><dt>{t.detail.advInvoiced}</dt><dd className="num">{money(bal?.advance_invoiced)}</dd></div>
            <div><dt>{t.detail.advRecovered}</dt><dd className="num">{money(bal?.advance_recovered)}</dd></div>
            <div className="hl"><dt>{t.col.advOut}</dt><dd className="num">{money(bal?.advance_outstanding)}</dd></div>
            <div><dt>{t.detail.retHeld}</dt><dd className="num">{money(bal?.retention_held)}</dd></div>
            <div><dt>{t.detail.retReleased}</dt><dd className="num">{money(bal?.retention_released)}</dd></div>
            <div className="hl"><dt>{t.col.retOut}</dt><dd className="num">{money(bal?.retention_outstanding)}</dd></div>
          </dl>
        </section>

        <section className="card">
          <h2>{t.detail.partnerShareTitle}</h2>
          {agreements && agreements.length > 0 ? (
            <>
              {agreements.map((a) => (
                <p key={a.id} className="partner-line">
                  <b>{name(a.partner as unknown as { name_ar: string; name_en: string | null })}</b>
                  <span className="chip num">{pct(a.share_pct)}</span>
                  <span className="muted small num">{a.effective_from}</span>
                </p>
              ))}
              {manager && (
                <dl className="kv">
                  <div><dt>{t.detail.entitled}</dt><dd className="num">{money(partnerTotals.e)}</dd></div>
                  <div><dt>{t.detail.settled}</dt><dd className="num">{money(partnerTotals.s)}</dd></div>
                  <div className="hl"><dt>{t.detail.outstanding}</dt><dd className="num">{money(partnerTotals.o)}</dd></div>
                </dl>
              )}
              <p className="note">{t.form.partnerNote}</p>
            </>
          ) : (
            <p className="muted">{t.detail.noPartner}</p>
          )}
        </section>
      </div>

      {manager && prof && (
        <section className="card">
          <h2>{t.detail.profitability}</h2>
          <div className="kpis compact">
            <div className="kpi"><span className="kpi-label">{t.detail.revenue}</span><span className="kpi-value num">{money(prof.revenue)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.detail.directCosts}</span><span className="kpi-value num">{money(prof.direct_costs)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.detail.partnerCost}</span><span className="kpi-value num">{money(prof.partner_share_cost)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.detail.grossProfit}</span><span className="kpi-value num">{money(prof.gross_profit)}</span></div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>{t.detail.documents}</h2>
        {docs && docs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className="num">{d.issuer_ref ?? "—"}</td><td>{d.doc_type}</td>
                    <td className="num">{d.issue_date}</td><td>{d.status}</td>
                    <td className="n num">{money(d.collectible_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t.detail.noDocs}</p>
        )}
      </section>
    </div>
  );
}
