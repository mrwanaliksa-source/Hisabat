import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange, daysBetween } from "@/lib/reports";
import { ReportHeader } from "@/components/ReportHeader";

export default async function AgingReport({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = dateRange(await searchParams);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: docs }, { data: parties }, { data: projects }] = await Promise.all([
    supabase.from("v_sales_document_balances").select("id,customer_id,project_id,doc_type,issuer_ref,issue_date,collectible_total,balance")
      .eq("company_id", company.id).eq("status", "posted").gt("balance", 0).lte("issue_date", to).order("issue_date"),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).eq("kind", "customer"),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
  ]);
  const cn = new Map((parties ?? []).map((p) => [p.id, (lang === "en" && p.name_en) || p.name_ar]));
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const bucket = (days: number) => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3);
  const byCustomer = new Map<string, number[]>();
  for (const d of docs ?? []) {
    const arr = byCustomer.get(d.customer_id) ?? [0, 0, 0, 0];
    arr[bucket(daysBetween(d.issue_date, to))] += Number(d.balance);
    byCustomer.set(d.customer_id, arr);
  }
  const tot = [...byCustomer.values()].reduce((s, a) => s.map((v, i) => v + a[i]), [0, 0, 0, 0]);
  const heads = [t.rep.aging.b1, t.rep.aging.b2, t.rep.aging.b3, t.rep.aging.b4];

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.aging.t} desc={t.rep.aging.d} name="customer-aging" asOf={to} />
      <section className="card">
        <h2>{t.cash.customer}</h2>
        {byCustomer.size ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.customer}</th>{heads.map((h) => <th key={h} className="n">{h}</th>)}<th className="n">{t.rep.total}</th></tr></thead>
            <tbody>{[...byCustomer.entries()].map(([c, a]) => (
              <tr key={c}><td>{cn.get(c)}</td>{a.map((v, i) => <td key={i} className={`n num ${i === 3 && v > 0 ? "neg" : ""}`}>{v ? money(v) : "—"}</td>)}
                <td className="n num"><b>{money(a.reduce((x, y) => x + y, 0))}</b></td></tr>))}</tbody>
            <tfoot><tr><th>{t.rep.total}</th>{tot.map((v, i) => <th key={i} className="n num">{money(v)}</th>)}<th className="n num">{money(tot.reduce((x, y) => x + y, 0))}</th></tr></tfoot>
          </table></div>
        ) : <p className="muted">{t.rep.none}</p>}
      </section>
      {(docs ?? []).length > 0 && (
        <section className="card">
          <h2>{t.sales.title}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.customer}</th><th>{t.sales.project}</th><th>{t.sales.issuerRef}</th><th>{t.sales.docType}</th>
              <th>{t.sales.issueDate}</th><th className="n">{t.rep.aging.days}</th><th className="n">{t.form.due}</th><th className="n">{t.sales.balance}</th></tr></thead>
            <tbody>{(docs ?? []).map((d) => (
              <tr key={d.id}><td>{cn.get(d.customer_id)}</td><td className="num">{pc.get(d.project_id)}</td>
                <td><Link className="link num" href={`/sales/${d.id}`}>{d.issuer_ref ?? "—"}</Link></td>
                <td>{t.docType[d.doc_type as keyof typeof t.docType]}</td><td className="num">{d.issue_date}</td>
                <td className="n num">{daysBetween(d.issue_date, to)}</td><td className="n num">{money(d.collectible_total)}</td>
                <td className="n num"><b>{money(d.balance)}</b></td></tr>))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
