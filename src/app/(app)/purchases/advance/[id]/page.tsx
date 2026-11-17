import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { deleteAdvance } from "./actions";

export default async function AdvanceDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const { data: a } = await supabase.from("v_supplier_advances").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!a) notFound();
  const [{ data: uses }, { data: acc }, { data: proj }] = await Promise.all([
    supabase.from("supplier_payments").select("id,pay_date,amount,doc:purchase_documents(id,doc_number,details)").eq("advance_id", id).order("pay_date"),
    supabase.from("accounts").select("code,name_ar").eq("id", a.bank_account_id).maybeSingle(),
    a.project_id ? supabase.from("projects").select("id,code,name_ar").eq("id", a.project_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow">{t.adv.new}</p>
          <h1 className="page-title">{a.supplier_name}</h1>
          <p className="muted">{proj ? <Link className="link" href={`/projects/${proj.id}`}>{proj.code} · {proj.name_ar}</Link> : t.exp.general} · <span className="num">{a.pay_date}</span></p>
        </div>
        <Link href="/purchases" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}
      <div className="grid-2 top">
        <section className="card">
          <p className="details-text">{a.notes}</p>
          <dl className="kv">
            <div><dt>{t.adv.amount}</dt><dd className="num">{money(a.amount)}</dd></div>
            <div><dt>{t.adv.paidFrom}</dt><dd>{acc ? `${acc.code} · ${acc.name_ar}` : "—"}</dd></div>
            <div><dt>{t.adv.applied}</dt><dd className="num">{money(a.applied)}</dd></div>
            <div className="hl"><dt>{t.adv.waiting}</dt><dd className="num">{money(a.balance)}</dd></div>
            {a.reference && <div><dt>{t.cash.reference}</dt><dd className="num">{a.reference}</dd></div>}
          </dl>
        </section>
        <section className="card">
          <h2>{t.adv.usedOn}</h2>
          {uses && uses.length > 0 ? (
            <table className="small"><tbody>
              {uses.map((u) => {
                const d = u.doc as unknown as { id: string; doc_number: string; details: string | null } | null;
                return <tr key={u.id}><td className="num">{u.pay_date}</td>
                  <td>{d ? <Link className="link" href={`/purchases/${d.id}`}>{d.details ?? d.doc_number}</Link> : "—"}</td>
                  <td className="n num">{money(u.amount)}</td></tr>;
              })}
            </tbody></table>
          ) : <p className="muted">{t.adv.notUsed}</p>}
        </section>
      </div>
      {role === "admin" && (
        <details className="card danger-zone" id="delete" open>
          <summary>{t.adv.delete}</summary>
          <form action={deleteAdvance} className="stack mt">
            <input type="hidden" name="id" value={id} />
            <p className="muted small">{t.adv.deleteNote}</p>
            <label className="field"><span>{t.exp.reason}<b className="req"> *</b></span><input name="reason" required /></label>
            <label className="check"><input type="checkbox" name="confirm" value="1" required /> {t.exp.deleteConfirm}</label>
            <button className="btn danger self-start" data-act="delete-advance">{t.adv.delete}</button>
          </form>
        </details>
      )}
    </div>
  );
}
