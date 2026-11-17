import Link from "next/link";
import { Fragment } from "react";
import { addCommitment, toggleCommitment } from "./actions";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ unpaid?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const [{ data: docs }, { data: bal }, { data: custodies }, { data: people }, { data: advAll }, { data: projs }] = await Promise.all([
    supabase.from("purchase_documents")
      .select("id,issue_date,doc_number,details,total_amount,status,payment_source,created_by,project:projects(code),supplier:parties(name_ar,name_en)")
      .eq("company_id", company.id).order("issue_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
    supabase.from("v_purchase_balances").select("id,paid,balance").eq("company_id", company.id),
    supabase.from("v_custody").select("id,holder_name,purpose,balance,amount").eq("company_id", company.id).eq("status", "open"),
    supabase.from("profiles").select("id,full_name"),
    supabase.from("v_supplier_advances").select("id,supplier_id,supplier_name,pay_date,amount,applied,balance,notes,project_id")
      .eq("company_id", company.id).order("pay_date"),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
  ]);
  const { data: commits } = manager
    ? await supabase.from("v_supplier_commitments").select("*").eq("company_id", company.id).order("created_at")
    : { data: null };
  const advs = (advAll ?? []).filter((a) => Number(a.balance) > 0.004);
  const pcode = new Map((projs ?? []).map((x) => [x.id, x.code]));
  // payments without invoices, grouped by supplier (oldest first)
  const today = Date.now();
  type Adv = { id: string; supplier_id: string; supplier_name: string; pay_date: string; amount: number; applied: number; balance: number; notes: string | null };
  const groups = new Map<string, { name: string; total: number; oldest: string; rows: Adv[] }>();
  for (const a of (advs ?? []) as Adv[]) {
    const g = groups.get(a.supplier_id) ?? { name: a.supplier_name, total: 0, oldest: a.pay_date, rows: [] };
    g.total += Number(a.balance); g.rows.push(a); if (a.pay_date < g.oldest) g.oldest = a.pay_date;
    groups.set(a.supplier_id, g);
  }
  const ageDays = (d: string) => Math.max(0, Math.floor((today - new Date(d).getTime()) / 86400000));
  const b = new Map((bal ?? []).map((x) => [x.id, x]));
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  let rows = docs ?? [];
  if (sp.unpaid) rows = rows.filter((d) => Number(b.get(d.id)?.balance ?? 0) > 0.004);
  // invoices and payments-without-invoice in one list, newest first
  type Item = { k: "doc"; date: string; d: (typeof rows)[number] } | { k: "adv"; date: string; a: Adv & { project_id: string | null } };
  const items: Item[] = [
    ...rows.map((d) => ({ k: "doc" as const, date: d.issue_date as string, d })),
    ...((sp.unpaid ? advs : advAll ?? []) as (Adv & { project_id: string | null })[]).map((a) => ({ k: "adv" as const, date: a.pay_date, a })),
  ].sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  type S = { name_ar: string; name_en: string | null } | null;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.exp.title}</h1>
        <div className="actions">
          <Link href="/purchases/advance/new" className="btn soft">{t.adv.new}</Link>
          <Link href="/purchases/new" className="btn primary"><Icon name="camera" /> {t.exp.new}</Link>
        </div>
      </div>
      {sp.ok === "advance" && <p className="alert ok">✓ {t.adv.saved}</p>}
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok === "deleted" && <p className="alert ok">✓ {t.exp.deleted}</p>}

      {manager && (
        <section className="card stack" id="commitments">
          <h2>{t.cm.title}</h2>
          <p className="muted small">{t.cm.hint}</p>
          {commits && commits.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t.adv.supplier}</th><th>{t.cm.title1}</th><th>{t.exp.project}</th>
                  <th className="n">{t.cm.total}</th><th className="n">{t.cm.paid}</th><th className="n">{t.cm.remaining}</th><th /></tr></thead>
                <tbody>
                  {commits.map((c) => (
                    <tr key={c.id} className={c.closed_at ? "muted" : ""}>
                      <td><b>{c.supplier_name}</b></td><td>{c.title}</td><td className="num">{c.project_id ? pcode.get(c.project_id) : "—"}</td>
                      <td className="n num">{money(c.total_amount)}</td><td className="n num">{money(c.paid)}</td>
                      <td className="n num">{c.closed_at ? <span className="chip tiny">{t.cm.closed}</span> : <b className={Number(c.remaining) > 0.004 ? "warn-text" : ""}>{money(c.remaining)}</b>}</td>
                      <td><form action={toggleCommitment}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="close" value={c.closed_at ? "0" : "1"} />
                        <button className="btn ghost sm" data-act="toggle-commitment">{c.closed_at ? t.cm.reopen : t.cm.close}</button></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">{t.cm.none}</p>}
          <details>
            <summary className="btn soft sm">{t.cm.add}</summary>
            <form action={addCommitment} className="grid-3 mt">
              <label className="field"><span>{t.adv.supplier}<b className="req"> *</b></span><input name="supplier_name" required /></label>
              <label className="field"><span>{t.cm.title1}<b className="req"> *</b></span><input name="title" required placeholder="نسبة مبيعات 1% من PO …" /></label>
              <label className="field"><span>{t.cm.total}<b className="req"> *</b></span><input name="total_amount" inputMode="decimal" dir="ltr" required /></label>
              <label className="field"><span>{t.exp.project}</span>
                <select name="project_id" defaultValue=""><option value="">—</option>
                  {(projs ?? []).map((pj) => <option key={pj.id} value={pj.id}>{pj.code}</option>)}</select></label>
              <div className="field"><span>&nbsp;</span><button className="btn primary" data-act="add-commitment">{t.cm.add}</button></div>
            </form>
          </details>
        </section>
      )}

      {groups.size > 0 && (
        <section className="card" id="advances">
          <h2>{t.adv.title}</h2>
          <p className="muted small">{t.adv.chase}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.adv.supplier}</th><th>{t.adv.notes}</th><th>{t.exp.date}</th>
                  <th className="n">{t.adv.amount}</th><th className="n">{t.adv.applied}</th><th className="n">{t.adv.waiting}</th></tr>
              </thead>
              <tbody>
                {[...groups.values()].sort((a, b) => a.oldest.localeCompare(b.oldest)).map((g) => (
                  <Fragment key={g.name}>
                    <tr className="group-row">
                      <td colSpan={2}><b>{g.name}</b> <span className="chip tiny">{g.rows.length} · {t.adv.oldest} {ageDays(g.oldest)} {t.adv.days}</span></td>
                      <td></td><td></td><td></td>
                      <td className="n num"><b className="warn-text">{money(g.total)}</b></td>
                    </tr>
                    {g.rows.map((a) => (
                      <tr key={a.id}>
                        <td></td><td className="clip muted">{a.notes}</td><td className="num">{a.pay_date}</td>
                        <td className="n num">{money(a.amount)}</td><td className="n num">{Number(a.applied) ? money(a.applied) : "—"}</td>
                        <td className="n num">{money(a.balance)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {custodies && custodies.length > 0 && (
        <section className="card">
          <h2>{t.exp.openCustodies}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {custodies.map((c) => (
                  <tr key={c.id} className="custody-row">
                    <td>{t.exp.custodyRow} <b>{c.holder_name}</b></td>
                    <td className="muted">{c.purpose}</td>
                    <td className="n num">{money(c.amount)}</td>
                    <td className="n num"><b>{money(c.balance)}</b></td>
                    <td><Link className="btn soft sm" href={`/custody/${c.id}`}>{t.cus.settle}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        {items.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>{t.exp.date}</th><th>{t.exp.project}</th><th>{t.exp.supplier}</th><th>{t.exp.details}</th>
                  <th className="n">{t.exp.total}</th>{manager && <th className="n">{t.exp.balance}</th>}<th>{t.exp.by}</th></tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  if (it.k === "adv") {
                    const a = it.a, open = Number(a.balance) > 0.004;
                    return (
                      <tr key={"a" + a.id} className="adv-row">
                        <td className="num"><Link className="link" href="/purchases#advances">{a.pay_date}</Link></td>
                        <td className="num">{a.project_id ? pcode.get(a.project_id) ?? "—" : "—"}</td>
                        <td>{a.supplier_name}</td>
                        <td className="clip">{a.notes}{" "}
                          {open ? <span className="chip tiny warn">{t.adv.waiting}</span> : <span className="chip tiny ok">{t.adv.closedByInvoice}</span>}</td>
                        <td className="n num">{money(a.amount)}</td>
                        {manager && <td className="n num">{open ? <b className="warn-text">{money(a.balance)}</b> : "—"}</td>}
                        <td className="muted small"></td>
                      </tr>
                    );
                  }
                  const d = it.d;
                  const s = d.supplier as unknown as S;
                  const p = d.project as unknown as { code: string } | null;
                  const left = Number(b.get(d.id)?.balance ?? 0);
                  return (
                    <tr key={d.id}>
                      <td className="num"><Link className="link" href={`/purchases/${d.id}`}>{d.issue_date}</Link></td>
                      <td className="num">{p?.code ?? "—"}</td>
                      <td>{s ? (lang === "en" && s.name_en) || s.name_ar : "—"}</td>
                      <td className="clip"><Link href={`/purchases/${d.id}`}>{d.details ?? d.doc_number}</Link>
                        {d.payment_source === "custody" && <span className="chip tiny">{t.nav.custody}</span>}</td>
                      <td className="n num">{money(d.total_amount)}</td>
                      {manager && <td className="n num">{left > 0.004 ? <b className="warn-text">{money(left)}</b> : "—"}</td>}
                      <td className="muted small">{who.get(d.created_by ?? "") ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.exp.none}</p>}
      </section>
    </div>
  );
}
