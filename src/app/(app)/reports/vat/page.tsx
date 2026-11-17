import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange, periodKey } from "@/lib/reports";
import { ReportHeader } from "@/components/ReportHeader";

type Bucket = { sales: number; output: number; purchases: number; input: number; nonDed: number };
const empty = (): Bucket => ({ sales: 0, output: 0, purchases: 0, input: 0, nonDed: 0 });

export default async function VatReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const range = dateRange(await searchParams);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: co }, { data: projects }, { data: sales }, { data: purch }, { data: partners }] = await Promise.all([
    supabase.from("companies").select("vat_period").eq("id", company.id).maybeSingle(),
    supabase.from("projects").select("id,contract_holder,holder_partner_id").eq("company_id", company.id),
    supabase.from("sales_documents").select("project_id,issue_date,supply_date,payment_order_date,vat_base,vat_amount,customer:parties(is_government)")
      .eq("company_id", company.id).eq("status", "posted"),
    supabase.from("purchase_documents").select("project_id,issue_date,net_amount,vat_amount,eligible_vat,vat_owner_partner")
      .eq("company_id", company.id).eq("status", "posted"),
    supabase.from("parties").select("id,name_ar,name_en,vat_period").eq("company_id", company.id).eq("kind", "partner"),
  ]);
  const holder = new Map((projects ?? []).map((p) => [p.id, p.contract_holder === "partner" ? (p.holder_partner_id as string) : null]));
  const inRange = (d: string) => d >= range.from && d <= range.to;

  // owner → period → bucket ("company" or a partner id)
  const book = new Map<string, Map<string, Bucket>>();
  const periodOf = (owner: string) => (owner === "company"
    ? (co?.vat_period ?? "quarterly") : (partners?.find((p) => p.id === owner)?.vat_period ?? "quarterly")) as "monthly" | "quarterly";
  const add = (owner: string, date: string, f: (b: Bucket) => void) => {
    if (!inRange(date)) return;
    const k = periodKey(date, periodOf(owner));
    if (!book.has(owner)) book.set(owner, new Map());
    const m = book.get(owner)!;
    if (!m.has(k)) m.set(k, empty());
    f(m.get(k)!);
  };

  for (const d of sales ?? []) {
    const gov = (d.customer as unknown as { is_government: boolean } | null)?.is_government;
    const date = (gov && d.payment_order_date) || d.supply_date || d.issue_date;
    add(holder.get(d.project_id) ?? "company", date, (b) => { b.sales += Number(d.vat_base); b.output += Number(d.vat_amount); });
  }
  for (const d of purch ?? []) {
    const owner = d.vat_owner_partner || (d.project_id && holder.get(d.project_id)) || "company";
    add(owner, d.issue_date, (b) => {
      b.purchases += Number(d.net_amount); b.input += Number(d.eligible_vat); b.nonDed += Number(d.vat_amount) - Number(d.eligible_vat);
    });
  }

  const owners = ["company", ...[...book.keys()].filter((k) => k !== "company")];
  const ownerName = (o: string) => o === "company" ? t.rep.vat.company
    : `${t.rep.vat.partnerVat}: ${(() => { const p = partners?.find((x) => x.id === o); return p ? (lang === "en" && p.name_en) || p.name_ar : ""; })()}`;

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={t.rep.vat.t} desc={t.rep.vat.d} name="vat" range={range} />
      <p className="note">{t.rep.vat.govNote}</p>
      {owners.filter((o) => book.has(o)).length === 0 && <section className="card"><p className="muted">{t.rep.none}</p></section>}
      {owners.filter((o) => book.has(o)).map((o) => {
        const m = book.get(o)!;
        const keys = [...m.keys()].sort();
        const tot = keys.reduce((s, k) => { const b = m.get(k)!; return { sales: s.sales + b.sales, output: s.output + b.output,
          purchases: s.purchases + b.purchases, input: s.input + b.input, nonDed: s.nonDed + b.nonDed }; }, empty());
        return (
          <section key={o} className="card">
            <h2>{ownerName(o)} <span className="chip tiny">{periodOf(o) === "monthly" ? t.pp.monthly : t.pp.quarterly}</span></h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t.rep.vat.period}</th><th className="n">{t.rep.vat.sales}</th><th className="n">{t.rep.vat.output}</th>
                  <th className="n">{t.rep.vat.purchases}</th><th className="n">{t.rep.vat.input}</th><th className="n">{t.rep.vat.notDeductible}</th>
                  <th className="n">{t.rep.vat.net}</th></tr></thead>
                <tbody>
                  {keys.map((k) => { const b = m.get(k)!; const net = b.output - b.input; return (
                    <tr key={k}>
                      <td className="num">{k}</td><td className="n num">{money(b.sales)}</td><td className="n num">{money(b.output)}</td>
                      <td className="n num">{money(b.purchases)}</td><td className="n num">{money(b.input)}</td><td className="n num">{money(b.nonDed)}</td>
                      <td className={`n num ${net < 0 ? "pos" : ""}`}><b>{money(net)}</b>{net < 0 && <span className="muted small"> {t.rep.vat.credit}</span>}</td>
                    </tr>); })}
                </tbody>
                <tfoot><tr><th>{t.rep.total}</th><th className="n num">{money(tot.sales)}</th><th className="n num">{money(tot.output)}</th>
                  <th className="n num">{money(tot.purchases)}</th><th className="n num">{money(tot.input)}</th><th className="n num">{money(tot.nonDed)}</th>
                  <th className="n num">{money(tot.output - tot.input)}</th></tr></tfoot>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
