import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money, pct } from "@/lib/i18n";
import { setVatPeriod } from "./actions";

type L = { debit: number; credit: number; project_id: string | null; account: { system_key: string | null } | null;
  entry: { entry_date: string; source_type: string } | null };

export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const { id } = await params;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const { data: partner } = await supabase.from("parties").select("id,name_ar,name_en,vat_number,vat_period").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!partner) notFound();
  const [{ data: projects }, { data: agreements }, { data: bal }, { data: moves }, { data: lines }, { data: accts }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,status").eq("company_id", company.id).eq("holder_partner_id", id).order("code"),
    supabase.from("partner_agreements").select("project_id,share_pct,basis,effective_from,effective_to,project:projects(code,name_ar)").eq("partner_id", id).order("effective_from"),
    supabase.from("v_partner_balances").select("project_id,entitled,settled,outstanding").eq("partner_id", id),
    supabase.from("partner_transfers").select("direction,amount").eq("partner_id", id),
    supabase.from("journal_lines").select("debit,credit,project_id,account:accounts(system_key),entry:journal_entries(entry_date,source_type)")
      .eq("party_id", id).limit(10000),
    supabase.from("v_partner_project_accounts").select("project_id,collected_by_partner,held_by_partner").eq("partner_id", id),
  ]);
  const ls = (lines ?? []) as unknown as L[];
  const nm = (lang === "en" && partner.name_en) || partner.name_ar;
  const pcode = new Map((projects ?? []).map((p) => [p.id, p.code]));

  // ── VAT by month (on the partner's books: its invoices, purchases it reclaims, what it paid) ──
  type V = { output: number; input: number; paid: number; other: number };
  const vat = new Map<string, V>();
  for (const l of ls) {
    if (l.account?.system_key !== "partner_vat" || !l.entry) continue;
    const k = l.entry.entry_date.slice(0, 7);
    const v = vat.get(k) ?? { output: 0, input: 0, paid: 0, other: 0 };
    const src = l.entry.source_type;
    if (src === "sales_document") v.output += Number(l.credit) - Number(l.debit);
    else if (src === "purchase_document" || src === "vat_reclaimed_by_partner") v.input += Number(l.debit) - Number(l.credit);
    else if (src === "partner_transfer") v.paid += Number(l.debit) - Number(l.credit);
    else v.other += Number(l.credit) - Number(l.debit);
    vat.set(k, v);
  }
  const months = [...vat.keys()].sort();
  const vt = months.reduce((a, k) => { const v = vat.get(k)!; return { output: a.output + v.output, input: a.input + v.input, paid: a.paid + v.paid, other: a.other + v.other }; },
    { output: 0, input: 0, paid: 0, other: 0 });
  const vatDue = vt.output - vt.input - vt.paid + vt.other;

  // ── project money the partner holds ──
  const sumDir = (d: string) => (moves ?? []).filter((m) => m.direction === d).reduce((s, m) => s + Number(m.amount), 0);
  const paidExpenses = ls.filter((l) => l.account?.system_key === "partner_held_cash" && l.entry?.source_type === "supplier_payment")
    .reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  const collected = (accts ?? []).reduce((s, a) => s + Number(a.collected_by_partner), 0);
  const held = (accts ?? []).reduce((s, a) => s + Number(a.held_by_partner), 0);
  const shareTot = (bal ?? []).reduce((a, b) => ({ e: a.e + Number(b.entitled), s: a.s + Number(b.settled), o: a.o + Number(b.outstanding) }), { e: 0, s: 0, o: 0 });

  const Row = ({ k, v, strong, warn }: { k: string; v: number; strong?: boolean; warn?: boolean }) =>
    <div className={strong ? "hl" : ""}><dt>{k}</dt><dd className={`num ${warn ? "warn-text" : ""}`}>{money(Math.abs(v) < 0.005 ? 0 : v)}</dd></div>;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t.pt.partner}</p>
          <h1 className="page-title">{nm}</h1>
          <div className="muted inline-form">{partner.vat_number ? <span className="num">{partner.vat_number} ·</span> : null} {t.pp.vatPeriod}:
            {role === "admin" ? (
              <form action={setVatPeriod} className="inline-form">
                <input type="hidden" name="id" value={partner.id} />
                <select name="period" defaultValue={partner.vat_period ?? "quarterly"}>
                  <option value="monthly">{t.pp.monthly}</option><option value="quarterly">{t.pp.quarterly}</option>
                </select>
                <button className="btn ghost sm" data-act="save-vat-period">{t.set.save}</button>
              </form>
            ) : <b>{partner.vat_period === "monthly" ? t.pp.monthly : t.pp.quarterly}</b>}
          </div>
        </div>
        <Link href="/reports/partners" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {t.set.saved}</p>}

      <section className="card">
        <h2>{t.pt.projects}</h2>
        <table><tbody>
          {(agreements ?? []).map((a, i) => {
            const pj = a.project as unknown as { code: string; name_ar: string } | null;
            return <tr key={i}><td><Link className="link" href={`/projects/${a.project_id}`}>{pj?.code}</Link> · {pj?.name_ar}
              {pcode.has(a.project_id) && <span className="chip tiny">{t.dash.partnerHeld}</span>}</td>
              <td className="num">{pct(Number(a.share_pct))}</td>
              <td className="muted small">{a.basis === "profit_at_close" ? t.pp.basisProfit : t.pp.basisCollections}</td>
              <td className="muted small num">{a.effective_from}{a.effective_to ? ` → ${a.effective_to}` : ""}</td></tr>;
          })}
        </tbody></table>
      </section>

      <div className="grid-2 top">
        <section className="card">
          <h2>{t.pt.vat}</h2>
          <dl className="kv">
            <Row k={t.pt.vatOutput} v={vt.output} />
            <Row k={t.pt.vatInput} v={-vt.input} />
            <Row k={t.pt.vatPaid} v={-vt.paid} />
            {Math.abs(vt.other) > 0.004 && <Row k={t.pt.vatOther} v={vt.other} />}
            <Row k={vatDue >= 0 ? t.pt.vatDue : t.pt.vatCredit} v={vatDue} strong warn={vatDue > 0.004} />
          </dl>
          <p className="muted small">{t.pt.vatNote}</p>
        </section>
        <section className="card">
          <h2>{t.pt.money}</h2>
          <dl className="kv">
            <Row k={t.pp.collectedByPartner} v={collected} />
            <Row k={t.pp.toCompany} v={-sumDir("to_company")} />
            {sumDir("to_partner") > 0 && <Row k={t.pp.toPartner} v={sumDir("to_partner")} />}
            <Row k={t.pt.expensesPaid} v={-paidExpenses} />
            <Row k={t.pp.paidVat} v={-sumDir("partner_paid_vat")} />
            {sumDir("partner_kept_share") > 0 && <Row k={t.pp.keptShare} v={-sumDir("partner_kept_share")} />}
            {sumDir("partner_kept_zakat") > 0 && <Row k={t.pp.keptZakat} v={-sumDir("partner_kept_zakat")} />}
            <Row k={t.pt.heldNow} v={held} strong />
          </dl>
          <h3 className="mt">{t.pt.share}</h3>
          <dl className="kv">
            <Row k={t.detail.entitled} v={shareTot.e} />
            <Row k={t.detail.settled} v={shareTot.s} />
            <Row k={t.detail.outstanding} v={shareTot.o} strong />
          </dl>
        </section>
      </div>

      {months.length > 0 && (
        <section className="card">
          <h2>{t.pt.vatMonthly}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.rep.vat.period}</th><th className="n">{t.pt.vatOutput}</th><th className="n">{t.pt.vatInput}</th>
                <th className="n">{t.pt.vatPaid}</th><th className="n">{t.pt.vatNet}</th></tr></thead>
              <tbody>
                {months.map((k) => { const v = vat.get(k)!; return (
                  <tr key={k}><td className="num">{k}</td><td className="n num">{money(v.output)}</td><td className="n num">{money(v.input)}</td>
                    <td className="n num">{money(v.paid)}</td><td className="n num"><b>{money(v.output - v.input - v.paid + v.other)}</b></td></tr>); })}
              </tbody>
              <tfoot><tr><th>{t.rep.total}</th><th className="n num">{money(vt.output)}</th><th className="n num">{money(vt.input)}</th>
                <th className="n num">{money(vt.paid)}</th><th className="n num">{money(vatDue)}</th></tr></tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
