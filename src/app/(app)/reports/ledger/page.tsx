import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { dateRange } from "@/lib/reports";
import { fetchLines } from "@/lib/ledger";
import { ReportHeader } from "@/components/ReportHeader";

type SP = Promise<{ account?: string; from?: string; to?: string }>;

export default async function Ledger({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = dateRange(sp);
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: accounts }, { data: projects }, { data: parties }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en,type").eq("company_id", company.id).order("code"),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id),
  ]);
  const acc = (accounts ?? []).find((a) => a.id === sp.account) ?? null;
  const credit = acc && ["liability", "equity", "revenue"].includes(acc.type);   // natural credit balance
  const sign = credit ? -1 : 1;
  const lines = acc ? (await fetchLines(supabase, company.id, undefined, range.to)).filter((l) => l.account_id === acc.id) : [];
  const opening = lines.filter((l) => l.date < range.from).reduce((s, l) => s + sign * (l.debit - l.credit), 0);
  const inRange = lines.filter((l) => l.date >= range.from).sort((a, b) => a.date.localeCompare(b.date));
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const pn = new Map((parties ?? []).map((p) => [p.id, (lang === "en" && p.name_en) || p.name_ar]));
  let run = opening;
  const nm = (a: { name_ar: string; name_en: string | null }) => (lang === "en" && a.name_en) || a.name_ar;

  return (
    <div className="stack-lg" id="report">
      <ReportHeader t={t} title={acc ? `${t.rep.ledger.t}: ${acc.code} ${nm(acc)}` : t.rep.ledger.t} desc={t.rep.ledger.d}
        name={`ledger-${acc?.code ?? ""}`} range={range}
        extra={<label className="field"><span>{t.rep.ledger.choose}</span>
          <select name="account" defaultValue={acc?.id ?? ""} required>
            <option value="">—</option>
            {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {nm(a)}</option>)}
          </select></label>} />
      {acc && (
        <section className="card">
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.date}</th><th>{t.rep.ledger.memo}</th><th>{t.sales.project}</th><th>{t.cash.payee}</th>
              <th className="n">{t.rep.tb.debit}</th><th className="n">{t.rep.tb.credit}</th><th className="n">{t.rep.ledger.running}</th></tr></thead>
            <tbody>
              <tr className="sub"><td colSpan={6}>{t.rep.ledger.opening}</td><td className="n num"><b>{money(opening)}</b></td></tr>
              {inRange.map((l, i) => { run += sign * (l.debit - l.credit); return (
                <tr key={i}><td className="num">{l.date}</td><td className="clip">{l.memo}</td>
                  <td className="num">{l.project_id ? <Link className="link" href={`/projects/${l.project_id}`}>{pc.get(l.project_id)}</Link> : ""}</td>
                  <td>{l.party_id ? pn.get(l.party_id) : ""}</td>
                  <td className="n num">{l.debit ? money(l.debit) : ""}</td><td className="n num">{l.credit ? money(l.credit) : ""}</td>
                  <td className="n num">{money(run)}</td></tr>); })}
            </tbody>
            <tfoot><tr><th colSpan={4}>{t.rep.total}</th>
              <th className="n num">{money(inRange.reduce((s, l) => s + l.debit, 0))}</th>
              <th className="n num">{money(inRange.reduce((s, l) => s + l.credit, 0))}</th>
              <th className="n num">{money(run)}</th></tr></tfoot>
          </table></div>
        </section>
      )}
    </div>
  );
}
