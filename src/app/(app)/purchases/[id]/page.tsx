import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { paySupplier, applyAdvance, payByPartner, linkCommitment, deleteExpense, deletePayment } from "./actions";

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
    .select("*, project:projects(id,code,name_ar,name_en), supplier:parties!purchase_documents_supplier_id_fkey(name_ar,name_en,vat_number)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!d) notFound();
  type N = { name_ar: string; name_en: string | null; code?: string; id?: string; vat_number?: string | null };
  const nm = (x: unknown) => { const v = x as N | null; return v ? (lang === "en" && v.name_en) || v.name_ar : "—"; };
  const proj = d.project as unknown as N | null;
  const supp = d.supplier as unknown as N;

  const canApply = ["admin", "reviewer", "expense"].includes(role ?? "");
  const [{ data: bal }, { data: lines }, { data: banks }, { data: who }, photo, { data: advs }] = await Promise.all([
    supabase.from("v_purchase_balances").select("paid,balance").eq("id", id).maybeSingle(),
    manager && d.journal_entry_id ? supabase.from("journal_lines").select("id,debit,credit,account:accounts(code,name_ar,name_en)").eq("entry_id", d.journal_entry_id) : Promise.resolve({ data: null }),
    manager ? supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code") : Promise.resolve({ data: null }),
    supabase.from("profiles").select("full_name").eq("id", d.created_by ?? "").maybeSingle(),
    d.attachment_path ? supabase.storage.from("attachments").createSignedUrl(d.attachment_path, 600) : Promise.resolve({ data: null }),
    canApply ? supabase.from("v_supplier_advance_pool").select("balance,payments").eq("supplier_id", d.supplier_id)
             : Promise.resolve({ data: null }),
  ]);
  const { data: payRows } = await supabase.from("supplier_payments")
    .select("id,pay_date,amount,reference,advance_id,account:accounts(code,name_ar,is_bank,system_key)").eq("purchase_document_id", id).order("pay_date");
  const { data: cms } = canApply
    ? await supabase.from("v_supplier_commitments").select("id,title,total_amount,paid,remaining,closed_at").eq("supplier_id", d.supplier_id)
    : { data: null };
  const linkedCm = (cms ?? []).find((c) => c.id === d.commitment_id) ?? null;
  const { data: heldProjects } = manager
    ? await supabase.from("projects").select("id,code,holder:parties!projects_holder_partner_id_fkey(name_ar)")
        .eq("company_id", company.id).eq("contract_holder", "partner").neq("status", "closed").order("code")
    : { data: null };
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
        <div className="actions">
          {role === "admin" && <Link href={`/purchases/new?edit=${id}`} className="btn soft" data-act="edit">{t.exp.edit}</Link>}
          {role === "admin" && <a href="#delete" className="btn ghost danger">{t.exp.delete}</a>}
          <Link href="/purchases" className="btn ghost">{t.back}</Link>
        </div>
      </div>
      {sp.ok && <p className="alert ok">✓ {sp.ok === "advance" ? t.adv.appliedOk : sp.ok === "edited" ? t.exp.edited : sp.ok === "paymentDeleted" ? t.exp.paymentDeleted : t.exp.posted}</p>}
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
            {linkedCm && <div className="hl"><dt>{t.cm.linked}</dt><dd>{linkedCm.title} — {t.cm.paid} <span className="num">{money(linkedCm.paid)}</span> {t.cm.of} <span className="num">{money(linkedCm.total_amount)}</span>، {t.cm.remaining} <b className="num warn-text">{money(linkedCm.remaining)}</b></dd></div>}
          </dl>
          {canApply && cms && cms.length > 0 && (
            <form action={linkCommitment} className="inline-form">
              <input type="hidden" name="id" value={id} />
              <select name="commitment" defaultValue={d.commitment_id ?? ""}>
                <option value="">{t.cm.noneOpt}</option>
                {cms.map((c) => <option key={c.id} value={c.id}>{c.title} — {t.cm.remaining} {money(c.remaining)}</option>)}
              </select>
              <button className="btn ghost sm" data-act="link-commitment">{t.cm.link}</button>
            </form>
          )}
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
          {payRows && payRows.length > 0 && (
            <table className="small">
              <thead><tr><th colSpan={role === "admin" ? 4 : 3}>{t.exp.howPaid}</th></tr></thead>
              <tbody>
                {payRows.map((r) => {
                  const a = r.account as unknown as { code: string; name_ar: string; is_bank: boolean; system_key: string | null } | null;
                  const src = r.advance_id ? t.exp.srcAdvance : a?.system_key === "partner_held_cash" ? t.exp.byPartner
                    : a?.system_key === "custody" ? t.nav.custody : a ? `${a.code} · ${a.name_ar}` : "";
                  return (
                    <tr key={r.id}><td className="num">{r.pay_date}</td><td>{src}</td><td className="n num">{money(r.amount)}</td>
                      {role === "admin" && <td>
                        <form action={deletePayment} className="inline-form">
                          <input type="hidden" name="id" value={id} /><input type="hidden" name="payment" value={r.id} />
                          <input name="reason" required placeholder={t.exp.reason} className="pw-input" />
                          <button className="btn ghost sm danger" data-act="delete-payment" title={t.exp.deletePayment}>✕</button>
                        </form></td>}
                    </tr>);
                })}
                {left > 0.004 && <tr><td /><td className="warn-text">{t.exp.balance}</td><td className="n num warn-text">{money(left)}</td></tr>}
              </tbody>
            </table>
          )}
          {canApply && left > 0.004 && advs && advs.length > 0 && Number(advs[0].balance) > 0.004 && (
            <form action={applyAdvance} className="stack apply-adv">
              <h3>{t.adv.applyTitle}</h3>
              <p className="small">{t.adv.poolIs} <b className="num">{money(advs[0].balance)}</b> ({advs[0].payments} {t.adv.payments})</p>
              <input type="hidden" name="id" value={id} />
              <label className="field"><span>{t.cash.payAmount}</span>
                <input name="amount" inputMode="decimal" dir="ltr" defaultValue={Math.min(left, Number(advs[0].balance))} /></label>
              <button className="btn soft" data-act="apply-advance">{t.adv.apply}</button>
            </form>
          )}
          {manager && left > 0.004 && heldProjects && heldProjects.length > 0 && (
            <form action={payByPartner} className="stack apply-adv">
              <h3>{t.exp.byPartner}</h3>
              <input type="hidden" name="id" value={id} />
              <div className="grid-2">
                <label className="field"><span>{t.exp.byPartnerFrom}</span>
                  <select name="project" defaultValue={heldProjects.find((h) => h.id === d.project_id)?.id}>
                    {heldProjects.map((h) => <option key={h.id} value={h.id}>{(h.holder as unknown as { name_ar: string } | null)?.name_ar} — {t.parts.moneyOf} {h.code}</option>)}
                  </select></label>
                <label className="field"><span>{t.cash.payAmount}</span><input name="amount" inputMode="decimal" dir="ltr" defaultValue={left} /></label>
                <label className="field"><span>{t.cash.date}</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              </div>
              {Number(d.vat_amount) - Number(d.eligible_vat ?? 0) > 0 && (
                <label className="check"><input type="checkbox" name="reclaim" value="1" defaultChecked /> {t.exp.partnerReclaims}</label>
              )}
              <button className="btn soft" data-act="pay-partner">{t.exp.byPartner}</button>
            </form>
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
      {role === "admin" && (
        <details className="card danger-zone" id="delete" open>
          <summary>{t.exp.delete}</summary>
          <form action={deleteExpense} className="stack mt">
            <input type="hidden" name="id" value={id} />
            <p className="muted small">{t.exp.deleteNote}</p>
            <label className="field"><span>{t.exp.reason}<b className="req"> *</b></span><input name="reason" required /></label>
            <label className="check"><input type="checkbox" name="confirm" value="1" required /> {t.exp.deleteConfirm}</label>
            <button className="btn danger self-start" data-act="delete">{t.exp.delete}</button>
          </form>
        </details>
      )}
    </div>
  );
}
