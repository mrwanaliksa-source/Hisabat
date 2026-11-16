import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange } from "@/lib/reports";
import { fetchLines } from "@/lib/ledger";
import { ReportHeader } from "@/components/ReportHeader";

export default async function ProfitReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = dateRange(await searchParams);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [lines, { data: projects }] = await Promise.all([
    fetchLines(supabase, company.id, range.from, range.to),
    supabase.from("projects").select("id,code,name_ar,name_en,budget,status,contract_holder").eq("company_id", company.id).order("code"),
  ]);
  const rows = (projects ?? []).map((p) => {
    const mine = lines.filter((l) => l.project_id === p.id);
    const revenue = mine.filter((l) => l.type === "revenue").reduce((s, l) => s + l.credit - l.debit, 0);
    const share = mine.filter((l) => l.key === "partner_share_cost").reduce((s, l) => s + l.debit - l.credit, 0);
    const costs = mine.filter((l) => l.type === "expense" && l.key !== "partner_share_cost").reduce((s, l) => s + l.debit - l.credit, 0);
    const profit = revenue - costs - share;
    return { p, revenue, costs, share, profit, budget: Number(p.budget ?? 0) };
  }).filter((r) => r.revenue || r.costs || r.share);
  const tot = rows.reduce((s, r) => ({ revenue: s.revenue + r.revenue, costs: s.costs + r.costs, share: s.share + r.share, profit: s.profit + r.profit }),
    { revenue: 0, costs: 0, share: 0, profit: 0 });
  const pctOf = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.profit.t} desc={t.rep.profit.d} name="profitability" range={range} />
      <section className="card">
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.col.code}</th><th>{t.col.name}</th><th className="n">{t.rep.profit.revenue}</th><th className="n">{t.rep.profit.costs}</th>
                <th className="n">{t.rep.profit.share}</th><th className="n">{t.rep.profit.profit}</th><th className="n">{t.rep.profit.margin}</th>
                <th className="n">{t.rep.profit.budget}</th><th className="n">{t.rep.profit.used}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id}>
                    <td><Link className="link num" href={`/projects/${r.p.id}`}>{r.p.code}</Link></td>
                    <td>{(lang === "en" && r.p.name_en) || r.p.name_ar}</td>
                    <td className="n num">{money(r.revenue)}</td><td className="n num">{money(r.costs)}</td>
                    <td className="n num">{money(r.share)}</td>
                    <td className={`n num ${r.profit < 0 ? "neg" : ""}`}><b>{money(r.profit)}</b></td>
                    <td className="n num">{pctOf(r.profit, r.revenue)}</td>
                    <td className="n num">{r.budget ? money(r.budget) : "—"}</td>
                    <td className={`n num ${r.budget && r.costs > r.budget ? "neg" : ""}`}>{pctOf(r.costs, r.budget)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><th colSpan={2}>{t.rep.total}</th><th className="n num">{money(tot.revenue)}</th><th className="n num">{money(tot.costs)}</th>
                <th className="n num">{money(tot.share)}</th><th className="n num">{money(tot.profit)}</th><th className="n num">{pctOf(tot.profit, tot.revenue)}</th><th /><th /></tr></tfoot>
            </table>
          </div>
        ) : <p className="muted">{t.rep.none}</p>}
      </section>
    </div>
  );
}
