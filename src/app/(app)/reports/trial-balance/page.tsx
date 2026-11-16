import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange } from "@/lib/reports";
import { fetchLines } from "@/lib/ledger";
import { ReportHeader } from "@/components/ReportHeader";

export default async function TrialBalance({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = dateRange(await searchParams);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const all = await fetchLines(supabase, company.id, undefined, range.to);          // cumulative, for balances
  const period = all.filter((l) => l.date >= range.from);                            // the period, for income
  type Acc = { id: string; code: string; name: string; type: string; debit: number; credit: number };
  const accounts = new Map<string, Acc>();
  for (const l of all) {
    const a = accounts.get(l.account_id) ?? { id: l.account_id, code: l.code, name: (lang === "en" && l.name_en) || l.name_ar, type: l.type, debit: 0, credit: 0 };
    a.debit += l.debit; a.credit += l.credit; accounts.set(l.account_id, a);
  }
  const list = [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
  const td = list.reduce((s, a) => s + a.debit, 0), tc = list.reduce((s, a) => s + a.credit, 0);

  const sumType = (lines: typeof all, type: string, sign: 1 | -1) => lines.filter((l) => l.type === type).reduce((s, l) => s + sign * (l.debit - l.credit), 0);
  const revenue = sumType(period, "revenue", -1), expenses = sumType(period, "expense", 1);
  const incomeRows = (type: string, sign: 1 | -1) => {
    const m = new Map<string, { code: string; name: string; v: number }>();
    for (const l of period.filter((x) => x.type === type)) {
      const r = m.get(l.account_id) ?? { code: l.code, name: (lang === "en" && l.name_en) || l.name_ar, v: 0 };
      r.v += sign * (l.debit - l.credit); m.set(l.account_id, r);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  };
  const assets = sumType(all, "asset", 1), liabilities = sumType(all, "liability", -1), equity = sumType(all, "equity", -1);
  const cumIncome = sumType(all, "revenue", -1) - sumType(all, "expense", 1);
  const balanced = Math.abs(assets - (liabilities + equity + cumIncome)) < 0.01;
  const bsRows = (type: string, sign: 1 | -1) => list.filter((a) => a.type === type)
    .map((a) => ({ ...a, v: sign * (a.debit - a.credit) })).filter((a) => Math.abs(a.v) > 0.004);

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.tb.t} desc={t.rep.tb.d} name="trial-balance" range={range} />

      <section className="card">
        <h2>{t.rep.tb.balance} — {t.rep.asOf} <span className="num">{range.to}</span></h2>
        <div className="table-wrap"><table>
          <thead><tr><th>{t.rep.tb.account}</th><th className="n">{t.rep.tb.debit}</th><th className="n">{t.rep.tb.credit}</th><th className="n">{t.rep.tb.balance}</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}><td><Link className="link" href={`/reports/ledger?account=${a.id}&to=${range.to}`}><span className="num muted">{a.code}</span> {a.name}</Link></td>
              <td className="n num">{money(a.debit)}</td><td className="n num">{money(a.credit)}</td><td className="n num"><b>{money(a.debit - a.credit)}</b></td></tr>))}</tbody>
          <tfoot><tr><th>{t.rep.total}</th><th className="n num">{money(td)}</th><th className="n num">{money(tc)}</th><th className="n num">{money(td - tc)}</th></tr></tfoot>
        </table></div>
      </section>

      <div className="grid-2 top">
        <section className="card">
          <h2>{t.rep.tb.income} <span className="muted small num">{range.from} → {range.to}</span></h2>
          <table>
            <tbody>
              {incomeRows("revenue", -1).map((r) => <tr key={r.code}><td><span className="num muted">{r.code}</span> {r.name}</td><td className="n num">{money(r.v)}</td></tr>)}
              <tr className="sub"><th>{t.rep.profit.revenue}</th><th className="n num">{money(revenue)}</th></tr>
              {incomeRows("expense", 1).map((r) => <tr key={r.code}><td><span className="num muted">{r.code}</span> {r.name}</td><td className="n num">({money(r.v)})</td></tr>)}
              <tr className="sub"><th>{t.rep.profit.costs}</th><th className="n num">({money(expenses)})</th></tr>
            </tbody>
            <tfoot><tr><th>{t.rep.tb.netIncome}</th><th className={`n num ${revenue - expenses < 0 ? "neg" : ""}`}>{money(revenue - expenses)}</th></tr></tfoot>
          </table>
        </section>

        <section className="card">
          <h2>{t.rep.tb.bs} <span className="muted small">{t.rep.asOf} <span className="num">{range.to}</span></span></h2>
          <table>
            <tbody>
              {bsRows("asset", 1).map((a) => <tr key={a.id}><td><span className="num muted">{a.code}</span> {a.name}</td><td className="n num">{money(a.v)}</td></tr>)}
              <tr className="sub"><th>{t.rep.tb.assets}</th><th className="n num">{money(assets)}</th></tr>
              {bsRows("liability", -1).map((a) => <tr key={a.id}><td><span className="num muted">{a.code}</span> {a.name}</td><td className="n num">{money(a.v)}</td></tr>)}
              <tr className="sub"><th>{t.rep.tb.liabilities}</th><th className="n num">{money(liabilities)}</th></tr>
              {bsRows("equity", -1).map((a) => <tr key={a.id}><td><span className="num muted">{a.code}</span> {a.name}</td><td className="n num">{money(a.v)}</td></tr>)}
              <tr><td>{t.rep.tb.netIncome}</td><td className="n num">{money(cumIncome)}</td></tr>
            </tbody>
            <tfoot><tr><th>{t.rep.tb.totalLE}</th><th className="n num">{money(liabilities + equity + cumIncome)}</th></tr></tfoot>
          </table>
          <p className={`alert ${balanced ? "ok" : "error"}`}>{balanced ? `✓ ${t.rep.tb.balanced}` : t.rep.tb.unbalanced}</p>
        </section>
      </div>
    </div>
  );
}
