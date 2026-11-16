import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { ReportHeader } from "@/components/ReportHeader";

export default async function CustodyReport() {
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const { data } = await supabase.from("v_custody").select("*").eq("company_id", company.id).in("status", ["open", "settled"]).order("disbursed_on");
  const rows = data ?? [];
  const byEmp = new Map<string, { name: string; n: number; amount: number; invoices: number; returned: number; balance: number }>();
  for (const r of rows) {
    const e = byEmp.get(r.user_id) ?? { name: r.holder_name, n: 0, amount: 0, invoices: 0, returned: 0, balance: 0 };
    e.n++; e.amount += Number(r.amount); e.invoices += Number(r.invoices); e.returned += Number(r.returned); e.balance += Number(r.balance);
    byEmp.set(r.user_id, e);
  }
  const tot = [...byEmp.values()].reduce((s, e) => ({ amount: s.amount + e.amount, invoices: s.invoices + e.invoices, returned: s.returned + e.returned, balance: s.balance + e.balance }),
    { amount: 0, invoices: 0, returned: 0, balance: 0 });
  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.custody.t} desc={t.rep.custody.d} name="custody" />
      <section className="card">
        <h2>{t.rep.custody.employee}</h2>
        {byEmp.size ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.rep.custody.employee}</th><th className="n">{t.rep.custody.count}</th><th className="n">{t.cus.amount}</th>
              <th className="n">{t.cus.invoices}</th><th className="n">{t.cus.returned}</th><th className="n">{t.cus.balance}</th></tr></thead>
            <tbody>{[...byEmp.entries()].map(([id, e]) => (
              <tr key={id}><td>{e.name}</td><td className="n num">{e.n}</td><td className="n num">{money(e.amount)}</td>
                <td className="n num">{money(e.invoices)}</td><td className="n num">{money(e.returned)}</td>
                <td className="n num"><b>{money(e.balance)}</b></td></tr>))}</tbody>
            <tfoot><tr><th>{t.rep.total}</th><th /><th className="n num">{money(tot.amount)}</th><th className="n num">{money(tot.invoices)}</th>
              <th className="n num">{money(tot.returned)}</th><th className="n num">{money(tot.balance)}</th></tr></tfoot>
          </table></div>
        ) : <p className="muted">{t.rep.none}</p>}
      </section>
      {rows.length > 0 && (
        <section className="card">
          <h2>{t.cus.title}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cus.holder}</th><th>{t.cus.purpose}</th><th>{t.cash.date}</th><th className="n">{t.cus.amount}</th>
              <th className="n">{t.cus.invoices}</th><th className="n">{t.cus.returned}</th><th className="n">{t.cus.balance}</th><th>{t.cus.status}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{r.holder_name}</td><td className="clip"><Link className="link" href={`/custody/${r.id}`}>{r.purpose}</Link></td>
                <td className="num">{r.disbursed_on}</td><td className="n num">{money(r.amount)}</td><td className="n num">{money(r.invoices)}</td>
                <td className="n num">{money(r.returned)}</td><td className="n num"><b>{money(r.balance)}</b></td>
                <td><span className={`chip cs-${r.status}`}>{t.cus.st[r.status as keyof typeof t.cus.st]}</span></td></tr>))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
