import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";
import { reverseReceipt } from "./actions";

export default async function CashPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role)) redirect("/");

  const [{ data: receipts }, { data: partners }, { data: parties }, { data: projects }, { data: held }] = await Promise.all([
    supabase.from("v_receipt_balances").select("*").eq("company_id", company.id).order("receipt_date", { ascending: false }).limit(100),
    supabase.from("v_partner_balances").select("*").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).in("kind", ["customer", "partner"]),
    supabase.from("projects").select("id,code").eq("company_id", company.id),
    supabase.from("v_partner_project_accounts").select("*").eq("company_id", company.id).order("code"),
  ]);
  const pn = new Map((parties ?? []).map((p) => [p.id, (lang === "en" && p.name_en) || p.name_ar]));

  // money out: suppliers (from bank/cash only), custody disbursed, partner transfers & share payments
  const [{ data: banks }, { data: tb }, { data: sp_ }, { data: cus }, { data: pt }, { data: ps }, { data: supp }] = await Promise.all([
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("v_trial_balance").select("account_id,balance").eq("company_id", company.id),
    supabase.from("supplier_payments").select("id,pay_date,amount,bank_account_id,supplier_id,reference,doc:purchase_documents(id,details,doc_number)").eq("company_id", company.id).order("pay_date", { ascending: false }).limit(200),
    supabase.from("v_custody").select("id,holder_name,purpose,amount,disbursed_on").eq("company_id", company.id).not("disbursed_on", "is", null),
    supabase.from("partner_transfers").select("id,transfer_date,amount,bank_account_id,partner_id,reference,project_id").eq("company_id", company.id).eq("direction", "to_partner"),
    supabase.from("partner_settlements").select("id,settle_date,amount,bank_account_id,partner_id,reference").eq("company_id", company.id),
    supabase.from("parties").select("id,name_ar,name_en").eq("company_id", company.id).eq("kind", "supplier"),
  ]);
  const bankName = new Map((banks ?? []).map((b) => [b.id, `${b.code} · ${(lang === "en" && b.name_en) || b.name_ar}`]));
  const bal = new Map((tb ?? []).map((r) => [r.account_id, Number(r.balance)]));
  const sn = new Map((supp ?? []).map((p) => [p.id, (lang === "en" && p.name_en) || p.name_ar]));
  type Out = { key: string; date: string; type: string; payee: string; detail: string; account: string; amount: number; href?: string };
  const out: Out[] = [
    ...(sp_ ?? []).filter((x) => bankName.has(x.bank_account_id)).map((x) => {
      const d = x.doc as unknown as { id: string; details: string | null; doc_number: string } | null;
      return { key: "s" + x.id, date: x.pay_date, type: t.cash.ptSupplier, payee: sn.get(x.supplier_id) ?? "", detail: d?.details ?? d?.doc_number ?? "",
               account: bankName.get(x.bank_account_id) ?? "", amount: Number(x.amount), href: d ? `/purchases/${d.id}` : undefined };
    }),
    ...(cus ?? []).map((x) => ({ key: "c" + x.id, date: x.disbursed_on as string, type: t.cash.ptCustody, payee: x.holder_name, detail: x.purpose,
               account: "", amount: Number(x.amount), href: `/custody/${x.id}` })),
    ...(pt ?? []).map((x) => ({ key: "t" + x.id, date: x.transfer_date, type: t.cash.ptPartnerOut, payee: pn.get(x.partner_id) ?? "", detail: x.reference ?? "",
               account: bankName.get(x.bank_account_id ?? "") ?? "", amount: Number(x.amount), href: `/projects/${x.project_id}` })),
    ...(ps ?? []).map((x) => ({ key: "p" + x.id, date: x.settle_date, type: t.cash.ptPartnerPay, payee: pn.get(x.partner_id) ?? "", detail: x.reference ?? "",
               account: bankName.get(x.bank_account_id) ?? "", amount: Number(x.amount) })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));
  const anyUnalloc = (receipts ?? []).some((r) => Number(r.unallocated) > 0.004);
  const pc = new Map((projects ?? []).map((p) => [p.id, p.code]));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">{t.cash.title}</h1>
        <Link href="/cash/receipt/new" className="btn primary"><Icon name="in" /> {t.cash.newReceipt}</Link>
      </div>
      {sp.ok && <p className="alert ok">✓</p>}
      {sp.err && <p className="alert error">{sp.err}</p>}

      <section className="kpis">
        {(banks ?? []).map((b) => (
          <div key={b.id} className="kpi">
            <span className="kpi-label">{bankName.get(b.id)}</span>
            <span className="kpi-value num">{money(bal.get(b.id) ?? 0)} <small>{t.sar}</small></span>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{t.cash.receipts}</h2>
        {receipts && receipts.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.cash.date}</th><th>{t.cash.customer}</th><th>{t.cash.reference}</th>
                <th className="n">{t.cash.amount}</th><th className="n">{t.cash.allocated}</th><th className="n">{t.cash.unallocated}</th><th /></tr></thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id} className={r.reversed_at ? "is-reversed" : ""}>
                    <td className="num">{r.receipt_date}</td><td>{pn.get(r.customer_id)}</td>
                    <td className="num">{r.reference ?? "—"}
                      {r.reversed_at && <><span className="chip tiny st-closed">{t.cash.reversed}</span> <span className="muted small">{r.reverse_reason}</span></>}</td>
                    <td className="n num"><span className={r.reversed_at ? "struck" : ""}>{money(r.amount)}</span></td>
                    <td className="n num">{money(r.allocated)}</td>
                    <td className="n num">{Number(r.unallocated) > 0 ? <b className="warn-text">{money(r.unallocated)}</b> : money(0)}</td>
                    <td className="actions">
                      {!r.reversed_at && Number(r.unallocated) > 0 && (
                        <Link className="btn soft sm" href={`/cash/receipt/new?receipt=${r.id}`}>{t.cash.allocateRest}</Link>
                      )}
                      {!r.reversed_at && (
                        <details className="inline-menu">
                          <summary className="btn ghost sm danger">{t.cash.reverse}</summary>
                          <form action={reverseReceipt} className="stack pop">
                            <input type="hidden" name="id" value={r.id} />
                            <p className="muted small">{t.cash.reverseHint}</p>
                            <label className="field"><span>{t.cash.reverseReason}<b className="req"> *</b></span><input name="reason" required /></label>
                            <button className="btn primary sm danger-fill" data-act="reverse">{t.cash.reverseConfirm}</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.cash.noReceipts}</p>}
        {anyUnalloc && <p className="note">{t.cash.unallocHint}</p>}
      </section>

      <section className="card">
        <h2>{t.cash.payments}</h2>
        {out.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.cash.date}</th><th>{t.cash.type}</th><th>{t.cash.payee}</th><th>{t.exp.details}</th>
                <th>{t.cash.from}</th><th className="n">{t.cash.payAmount}</th></tr></thead>
              <tbody>
                {out.map((o) => (
                  <tr key={o.key}>
                    <td className="num">{o.date}</td>
                    <td><span className="chip tiny">{o.type}</span></td>
                    <td>{o.payee}</td>
                    <td className="clip">{o.href ? <a className="link" href={o.href}>{o.detail || "—"}</a> : o.detail || "—"}</td>
                    <td className="muted small">{o.account}</td>
                    <td className="n num">{money(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.cash.noPayments}</p>}
      </section>

      <section className="card">
        <h2>{t.cash.partners}</h2>
        {partners && partners.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.cash.partner}</th><th>{t.sales.project}</th><th className="n">{t.form.netDue}</th>
                <th className="n">{t.detail.entitled}</th><th className="n">{t.detail.settled}</th><th className="n">{t.cash.outstanding}</th><th /></tr></thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={`${p.partner_id}-${p.project_id}`}>
                    <td>{pn.get(p.partner_id)}</td><td className="num">{pc.get(p.project_id)}</td>
                    <td className="n num">{money(p.net_collected)}</td><td className="n num">{money(p.entitled)}</td>
                    <td className="n num">{money(p.settled)}</td><td className="n num"><b>{money(p.outstanding)}</b></td>
                    <td>{Number(p.outstanding) > 0 && (
                      <Link className="btn soft sm" href={`/cash/partner?partner=${p.partner_id}&project=${p.project_id}`}>{t.cash.pay}</Link>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">{t.cash.noPartners}</p>}
      </section>
      {held && held.length > 0 && (
        <section className="card">
          <h2>{t.pp.heldTitle}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t.sales.project}</th><th>{t.cash.partner}</th><th className="n">{t.pp.collectedByPartner}</th>
                <th className="n">{t.pp.transferred}</th><th className="n">{t.pp.partnerVat}</th><th className="n">{t.pp.netDue}</th><th /></tr></thead>
              <tbody>
                {held.map((h) => (
                  <tr key={h.project_id}>
                    <td><Link className="link num" href={`/projects/${h.project_id}`}>{h.code}</Link></td>
                    <td>{pn.get(h.partner_id)}</td>
                    <td className="n num">{money(h.collected_by_partner)}</td><td className="n num">{money(h.transferred_to_company)}</td>
                    <td className="n num">{money(h.partner_vat_due)}</td><td className="n num"><b>{money(h.net_due_to_company)}</b></td>
                    <td><Link className="btn soft sm" href={`/cash/transfer?project=${h.project_id}`}>{t.pp.transfer}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

    </div>
  );
}
