import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { paySupplier } from "./actions";

type Params = Promise<{ id: string }>;

export default async function ExpenseDetail({ params, searchParams }: { params: Params; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: d } = await supabase.from("purchase_documents")
    .select("*, project:projects(id,code,name_ar,name_en), supplier:parties(name_ar,name_en,vat_number)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!d) notFound();
  type N = { name_ar: string; name_en: string | null; code?: string; id?: string; vat_number?: string | null };
  const nm = (x: unknown) => { const v = x as N | null; return v ? (lang === "en" && v.name_en) || v.name_ar : "—"; };
  const proj = d.project as unknown as N | null;
  const supp = d.supplier as unknown as N;

  const [{ data: bal }, { data: lines }, { data: banks }, { data: who }, photo] = await Promise.all([
    supabase.from("v_purchase_balances").select("paid,balance").eq("id", id).maybeSingle(),
    manager && d.journal_entry_id ? supabase.from("journal_lines").select("id,debit,credit,account:accounts(code,name_ar,name_en)").eq("entry_id", d.journal_entry_id) : Promise.resolve({ data: null }),
    manager ? supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code") : Promise.resolve({ data: null }),
    supabase.from("profiles").select("full_name").eq("id", d.created_by ?? "").maybeSingle(),
    d.attachment_path ? supabase.storage.from("attachments").createSignedUrl(d.attachment_path, 600) : Promise.resolve({ data: null }),
  ]);
  const left = Number(bal?.balance ?? 0);
  const photoUrl = (photo as { data: { signedUrl: string } | null })?.data?.signedUrl;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow num">{d.doc_number}</p>
          <h1 className="page-title">{nm(supp)}</h1>
          <p className="muted">{proj ? <Link className="link" href={`/projects/${proj.id}`}>{proj.code} · {nm(proj)}</Link> : t.exp.general} · <span className="num">{d.issue_date}</span></p>
        </div>
        <Link href="/purchases" className="btn ghost">{t.back}</Link>
      </div>
      {sp.ok && <p className="alert ok">✓ {t.exp.posted}</p>}
      {sp.err && <p className="alert error">{sp.err}</p>}

      <div className="grid-2 top">
        <section className="card">
          <h2>{t.exp.details}</h2>
          <p className="details-text">{d.details}</p>
          <dl className="kv">
            <div><dt>{t.exp.net}</dt><dd className="num">{money(d.net_amount)}</dd></div>
            <div><dt>{t.exp.vat}</dt><dd className="num">{money(d.vat_amount)}</dd></div>
            <div className="hl"><dt>{t.exp.total}</dt><dd className="num">{money(d.total_amount)}</dd></div>
            {Number(d.vat_amount) > 0 && <div><dt>{t.exp.vat}</dt><dd>{d.vat_eligibility === "full" ? t.exp.vatDeductible : t.exp.vatNotDeductible}</dd></div>}
            {supp?.vat_number && <div><dt>{t.exp.supplierVat}</dt><dd className="num">{supp.vat_number}</dd></div>}
            <div><dt>{t.exp.by}</dt><dd>{who?.full_name ?? ""}</dd></div>
          </dl>
          {photoUrl && <a className="btn soft sm" href={photoUrl} target="_blank" rel="noreferrer">{t.exp.viewPhoto}</a>}
        </section>

        <section className="card stack">
          <h2>{t.exp.payment}</h2>
          {manager ? (
            <dl className="kv">
              <div><dt>{t.exp.paid}</dt><dd className="num">{money(bal?.paid)}</dd></div>
              <div className="hl"><dt>{t.exp.balance}</dt><dd className="num">{money(left)}</dd></div>
            </dl>
          ) : (
            <p className="chips"><span className="chip">
              {d.payment_source === "credit" ? t.exp.payCredit : d.payment_source === "custody" ? t.nav.custody : t.exp.paid}
            </span></p>
          )}
          {manager && left > 0.004 && (
            <form action={paySupplier} className="stack">
              <input type="hidden" name="id" value={id} />
              <div className="grid-2">
                <label className="field"><span>{t.cash.payAmount}</span><input name="amount" inputMode="decimal" dir="ltr" defaultValue={left} /></label>
                <label className="field"><span>{t.cash.date}</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                <label className="field"><span>{t.exp.payAccount}</span>
                  <select name="account">{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {nm(b)}</option>)}</select></label>
                <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
              </div>
              <button className="btn primary" data-act="pay">{t.exp.payNow}</button>
            </form>
          )}
        </section>
      </div>

      {lines && lines.length > 0 && (
        <section className="card">
          <h2>{t.sales.journal}</h2>
          <table>
            <thead><tr><th>{t.sales.account}</th><th className="n">{t.sales.debit}</th><th className="n">{t.sales.credit}</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const a = l.account as unknown as { code: string; name_ar: string; name_en: string | null };
                return <tr key={l.id}><td><span className="num muted">{a.code}</span> {nm(a)}</td>
                  <td className="n num">{Number(l.debit) ? money(l.debit) : ""}</td><td className="n num">{Number(l.credit) ? money(l.credit) : ""}</td></tr>;
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
