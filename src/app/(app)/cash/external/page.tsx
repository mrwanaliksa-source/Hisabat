import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { ExternalForm, type ExtInitial } from "./ExternalForm";
import { deleteExternal } from "./actions";

export default async function ExternalPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; edit?: string; repay?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");
  const [{ data: banks }, { data: projects }, { data: rows }, { data: loans }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).eq("is_active", true).order("code"),
    supabase.from("projects").select("id,code,name_ar").eq("company_id", company.id).neq("status", "closed").order("code"),
    supabase.from("external_funds").select("id,kind,fund_date,amount,account_id,project_id,counterparty,notes,reference,supplier_payment_id,custody_id,owner_advance_id").eq("company_id", company.id)
      .order("fund_date", { ascending: false }).limit(200),
    supabase.from("v_loans").select("counterparty,borrowed,repaid,owed").eq("company_id", company.id),
  ]);
  // where a movement made elsewhere can be edited
  const spIds = (rows ?? []).map((r) => r.supplier_payment_id).filter(Boolean) as string[];
  const { data: sps } = spIds.length ? await supabase.from("supplier_payments").select("id,purchase_document_id").in("id", spIds) : { data: [] as { id: string; purchase_document_id: string }[] };
  const docOf = new Map((sps ?? []).map((x) => [x.id, x.purchase_document_id]));
  const editHref = (r: { id: string; supplier_payment_id: string | null; custody_id: string | null; owner_advance_id: string | null }) =>
    r.supplier_payment_id ? (docOf.get(r.supplier_payment_id) ? `/purchases/new?edit=${docOf.get(r.supplier_payment_id)}` : null)
    : r.custody_id ? `/custody/${r.custody_id}` : r.owner_advance_id ? "/cash/owners" : `/cash/external?edit=${r.id}#ext-form`;
  const er = sp.edit ? (rows ?? []).find((r) => r.id === sp.edit && !r.supplier_payment_id && !r.custody_id && !r.owner_advance_id) : undefined;
  const initial: ExtInitial | undefined = er ? { id: er.id, kind: er.kind, account: er.account_id ?? undefined, amount: String(Number(er.amount)), date: er.fund_date,
      project: er.project_id ?? "", who: er.counterparty ?? "", reference: er.reference ?? "", notes: er.notes ?? "" }
    : sp.repay ? { kind: "loan_out", who: sp.repay } : undefined;
  const bn = new Map((banks ?? []).map((b) => [b.id, `${b.code} · ${(lang === "en" && b.name_en) || b.name_ar}`]));
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));
  const kindsOut = ["owner_out", "loan_out"];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.ext.title}</h1>
        <Link href="/cash" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok && <p className="alert ok">✓ {sp.ok === "deleted" ? t.mv.deleted : t.mv.saved}</p>}
      <ExternalForm t={t} banks={(banks ?? []).map((b) => ({ id: b.id, name: bn.get(b.id) ?? "" }))}
        projects={(projects ?? []).map((p) => ({ id: p.id, name: `${p.code} · ${p.name_ar}` }))}
        lenders={(loans ?? []).map((l) => l.counterparty ?? "").filter(Boolean)} initial={initial} key={sp.edit ?? sp.repay ?? "new"} />

      {loans && loans.some((l) => Number(l.owed) > 0.004) && (
        <section className="card">
          <h2>{t.ext.loans}</h2>
          <table><thead><tr><th>{t.ext.who}</th><th className="n">{t.ext.borrowed}</th><th className="n">{t.ext.repaid}</th><th className="n">{t.ext.owed}</th><th /></tr></thead>
            <tbody>{loans.filter((l) => Number(l.owed) > 0.004).map((l) => (
              <tr key={l.counterparty}><td><b>{l.counterparty}</b></td><td className="n num">{money(l.borrowed)}</td><td className="n num">{money(l.repaid)}</td>
                <td className="n num"><b className="warn-text">{money(l.owed)}</b></td>
                <td><a className="btn soft sm" href={`/cash/external?repay=${encodeURIComponent(l.counterparty ?? "")}#ext-form`} data-act="repay">{t.ext.k.loan_out}</a></td></tr>))}</tbody></table>
        </section>
      )}

      <section className="card">
        <h2>{t.ext.list}</h2>
        {rows && rows.length > 0 ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{t.cash.date}</th><th>{t.ext.kind}</th><th>{t.ext.acc}</th><th>{t.mv.whose}</th><th>{t.mv.notes}</th><th className="n">{t.cash.payAmount}</th>{role === "admin" && <th />}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{r.fund_date}</td>
                <td>{t.ext.k[r.kind as keyof typeof t.ext.k]}{r.counterparty ? ` — ${r.counterparty}` : ""}</td>
                <td>{r.account_id ? bn.get(r.account_id) : <span className="muted">{t.ext.direct}</span>}</td><td className="num">{r.project_id ? pc.get(r.project_id) ?? "—" : t.mv.general}</td>
                <td className="muted">{[r.notes, r.reference].filter(Boolean).join(" · ")}</td>
                <td className={`n num ${kindsOut.includes(r.kind) ? "warn-text" : ""}`}>{kindsOut.includes(r.kind) ? "−" : "+"}{money(r.amount)}</td>
                {role === "admin" && <td><div className="actions">
                  {editHref(r) && <a className="btn soft sm" href={editHref(r)!} data-act="edit-external">{t.ext.edit}</a>}
                  {!r.supplier_payment_id && !r.custody_id && !r.owner_advance_id &&
                  <form action={deleteExternal} className="inline-form">
                    <input type="hidden" name="id" value={r.id} />
                    <input name="reason" required placeholder={t.exp.reason} className="pw-input" />
                    <button className="btn ghost sm danger" data-act="delete-external">✕</button>
                  </form>}</div></td>}
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="muted">{t.mv.none}</p>}
      </section>
    </div>
  );
}
