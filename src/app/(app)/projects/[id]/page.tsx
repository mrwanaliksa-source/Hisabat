import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money, pct } from "@/lib/i18n";
import { projectAction, adjustOpening, settleParts } from "./actions";

type Params = Promise<{ id: string }>;

export default async function ProjectDetail({ params, searchParams }: { params: Params; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const { data: p } = await supabase
    .from("projects")
    .select("*, customer:parties!projects_customer_id_fkey(name_ar,name_en,is_government)")
    .eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!p) notFound();

  const [{ data: bal }, { data: agreements }, { data: partnerBal }, { data: prof }, { data: docs }] = await Promise.all([
    supabase.from("v_project_advance_retention").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("partner_agreements").select("id,partner_id,share_pct,basis,effective_from,effective_to,partner:parties(name_ar,name_en)")
      .eq("project_id", id).order("effective_from"),
    manager ? supabase.from("v_partner_balances").select("*").eq("project_id", id) : Promise.resolve({ data: null }),
    manager ? supabase.from("v_project_profitability").select("*").eq("project_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("sales_documents").select("id,doc_type,issuer_ref,issue_date,status,collectible_total")
      .eq("project_id", id).order("issue_date", { ascending: false }).limit(20),
  ]);

  const holderPartner = p.contract_holder === "partner";
  const profitBasis = (agreements ?? []).some((a) => a.basis === "profit_at_close");
  const [{ data: acct }, { data: closeFig }] = await Promise.all([
    manager && holderPartner ? supabase.from("v_partner_project_accounts").select("*").eq("project_id", id).maybeSingle() : Promise.resolve({ data: null }),
    manager && profitBasis ? supabase.rpc("project_close_figures", { p_project: id }) : Promise.resolve({ data: null }),
  ]);
  const groupKey = p.group_id ?? null;
  const [{ data: gp }, { data: ipRows }, { data: cashRows }, { data: bankList }] = groupKey ? await Promise.all([
    supabase.from("projects").select("id,code,name_ar").eq("group_id", groupKey).order("code"),
    supabase.from("v_inter_part").select("project_id,balance").eq("company_id", company.id),
    supabase.from("v_project_cash").select("project_id,bank_net").eq("company_id", company.id),
    supabase.from("accounts").select("id,code,name_ar,project_id").eq("company_id", company.id).eq("is_bank", true).order("code"),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const groupParts = (gp ?? []) as { id: string; code: string; name_ar: string }[];
  const bankOf = (pid?: string) => ((bankList ?? []) as { id: string; project_id: string | null }[]).find((b) => b.project_id === pid)?.id;
  const ipMap = new Map((ipRows ?? []).map((r: { project_id: string; balance: number }) => [r.project_id, Number(r.balance)]));
  const cashMap = new Map((cashRows ?? []).map((r: { project_id: string; bank_net: number }) => [r.project_id, Number(r.bank_net)]));
  // money already out but not yet an expense: supplier payments awaiting invoices + open custody
  const [{ data: openAdv }, { data: openCus }] = manager ? await Promise.all([
    supabase.from("v_supplier_advances").select("balance").eq("project_id", id).gt("balance", 0),
    supabase.from("v_custody").select("balance").eq("project_id", id).eq("status", "open"),
  ]) : [{ data: [] }, { data: [] }];
  const advOpenP = (openAdv ?? []).reduce((s, x) => s + Number(x.balance), 0);
  const cusOpenP = (openCus ?? []).reduce((s, x) => s + Number(x.balance), 0);
  const cf = closeFig as null | { revenue: number; costs: number; profit: number; share: number; share_pct: number;
    settlement_to_company: number | null; pending_documents: number; closed: boolean; closed_at: string | null };
  const closed = p.status === "closed";

  const name = (x: { name_ar: string; name_en: string | null } | null | undefined) =>
    x ? (lang === "en" && x.name_en) || x.name_ar : "—";
  const cust = p.customer as { name_ar: string; name_en: string | null; is_government: boolean } | null;
  const partnerTotals = (partnerBal ?? []).reduce(
    (s, r) => ({ e: s.e + Number(r.entitled), s: s.s + Number(r.settled), o: s.o + Number(r.outstanding) }),
    { e: 0, s: 0, o: 0 }
  );

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow num">{p.code}</p>
          <h1 className="page-title">{(lang === "en" && p.name_en) || p.name_ar}</h1>
          <p className="muted">{name(cust)}{cust?.is_government ? ` · ${t.form.government}` : ""}</p>
          <p className="chips">
            <span className="chip">{t.pp.holder}: {holderPartner ? t.pp.holderPartner : t.pp.holderCompany}</span>
            {closed && <span className="chip st-closed">{t.pp.closed} · <span className="num">{p.closed_at}</span></span>}
          </p>
        </div>
        <div className="actions wrap">
          {!closed && <Link href={`/sales/new?project=${id}&type=progress_claim`} className="btn primary">{t.docType.progress_claim} +</Link>}
          {Number(p.advance_amount) > 0 && Number(bal?.advance_invoiced ?? 0) === 0 && (
            <Link href={`/sales/new?project=${id}&type=advance`} className="btn soft">{t.docType.advance} +</Link>
          )}
          {Number(bal?.retention_outstanding ?? 0) > 0 && (
            <Link href={`/sales/new?project=${id}&type=retention_release`} className="btn soft">{t.docType.retention_release} +</Link>
          )}
          {manager && <Link href={`/projects/${id}/edit`} className="btn ghost">{t.detail.edit}</Link>}
          <Link href="/projects" className="btn ghost">{t.back}</Link>
        </div>
      </div>

      {sp.err && <p className="alert error">{sp.err}</p>}
      {sp.ok === "close" && <p className="alert ok">✓ {t.pp.closed}</p>}
      {sp.ok === "edit" && <p className="alert ok">✓ {t.set.saved}</p>}

      <div className="grid-3">
        <section className="card">
          <h2>{t.detail.terms}</h2>
          <dl className="kv">
            <div><dt>{t.col.contract}</dt><dd className="num">{money(p.contract_value)}</dd></div>
            <div><dt>{t.form.advancePct}</dt><dd className="num">{pct(p.advance_pct)}</dd></div>
            <div><dt>{t.detail.advanceAmount}</dt><dd className="num">{money(p.advance_amount)}</dd></div>
            <div><dt>{t.form.recoveryPct}</dt><dd className="num">{pct(p.recovery_pct)}</dd></div>
            <div><dt>{t.form.retentionPct}</dt><dd className="num">{pct(p.retention_pct)}</dd></div>
            <div><dt>{t.form.retentionCap}</dt><dd className="num">{p.retention_cap_pct == null ? "—" : pct(p.retention_cap_pct)}</dd></div>
            {p.retention_release_terms && <div><dt>{t.form.releaseTerms}</dt><dd>{p.retention_release_terms}</dd></div>}
          </dl>
          <p className="note">{p.retention_vat_mode === "B" ? t.form.vatNoteB : t.form.vatNote}</p>
        </section>

        <section className="card">
          <h2>{t.detail.balances}</h2>
          <dl className="kv">
            <div><dt>{t.col.certified}</dt><dd className="num">{money(bal?.works_certified)}</dd></div>
            <div><dt>{t.detail.advInvoiced}</dt><dd className="num">{money(bal?.advance_invoiced)}</dd></div>
            <div><dt>{t.detail.advRecovered}</dt><dd className="num">{money(bal?.advance_recovered)}</dd></div>
            <div className="hl"><dt>{t.col.advOut}</dt><dd className="num">{money(bal?.advance_outstanding)}</dd></div>
            <div><dt>{t.detail.retHeld}</dt><dd className="num">{money(bal?.retention_held)}</dd></div>
            <div><dt>{t.detail.retReleased}</dt><dd className="num">{money(bal?.retention_released)}</dd></div>
            <div className="hl"><dt>{t.col.retOut}</dt><dd className="num">{money(bal?.retention_outstanding)}</dd></div>
          </dl>
        </section>

        <section className="card">
          <h2>{t.detail.partnerShareTitle}</h2>
          {agreements && agreements.length > 0 ? (
            <>
              {agreements.map((a) => (
                <p key={a.id} className="partner-line">
                  <Link className="link" href={`/partners/${a.partner_id}`}><b>{name(a.partner as unknown as { name_ar: string; name_en: string | null })}</b></Link>
                  <span className="chip num">{pct(a.share_pct)}</span>
                  <span className="muted small num">{a.effective_from}</span>
                  <span className="muted small">{a.basis === "profit_at_close" ? t.pp.basisProfit : t.pp.basisCollections}</span>
                </p>
              ))}
              {manager && !profitBasis && (
                <dl className="kv">
                  <div><dt>{t.detail.entitled}</dt><dd className="num">{money(partnerTotals.e)}</dd></div>
                  <div><dt>{t.detail.settled}</dt><dd className="num">{money(partnerTotals.s)}</dd></div>
                  <div className="hl"><dt>{t.detail.outstanding}</dt><dd className="num">{money(partnerTotals.o)}</dd></div>
                </dl>
              )}
              {manager && !profitBasis && partnerTotals.o > 0 && agreements[0] && (
                <Link className="btn soft sm" href={`/cash/partner?partner=${(agreements[0] as unknown as { partner_id?: string }).partner_id}&project=${id}`}>{t.cash.payPartner}</Link>
              )}
              <p className="note">{profitBasis ? t.pp.profitNote : t.form.partnerNote}</p>
            </>
          ) : (
            <p className="muted">{t.detail.noPartner}</p>
          )}
        </section>
      </div>

      {acct && (
        <section className="card">
          <div className="card-head">
            <h2>{t.pp.account}</h2>
            <Link className="btn soft sm" href={`/cash/transfer?project=${id}`}>{t.pp.transfer}</Link>
          </div>
          <div className="kpis compact">
            <div className="kpi"><span className="kpi-label">{t.pp.collectedByPartner}</span><span className="kpi-value num">{money(acct.collected_by_partner)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.pp.transferred}</span><span className="kpi-value num">{money(acct.transferred_to_company)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.pp.vatPaid}</span><span className="kpi-value num">{money(acct.vat_paid_by_partner)}</span></div>
            {Number(acct.share_kept_by_partner) > 0 && <div className="kpi"><span className="kpi-label">{t.pp.keptShare}</span><span className="kpi-value num">{money(acct.share_kept_by_partner)}</span></div>}
            {Number(acct.zakat_kept_by_partner) > 0 && <div className="kpi"><span className="kpi-label">{t.pp.keptZakat}</span><span className="kpi-value num">{money(acct.zakat_kept_by_partner)}</span></div>}
            <div className="kpi"><span className="kpi-label">{t.pp.held}</span><span className="kpi-value num">{money(acct.held_by_partner)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.pp.partnerVat}</span><span className="kpi-value num">{money(acct.partner_vat_due)}</span></div>
            <div className="kpi hl"><span className="kpi-label">{t.pp.netDue}</span><span className="kpi-value num">{money(acct.net_due_to_company)}</span></div>
          </div>
        </section>
      )}

      {groupParts.length > 1 && (
        <section className="card" id="parts">
          <h2>{t.parts.title}</h2>
          <table>
            <thead><tr><th>{t.parts.part}</th><th className="n">{t.parts.cash}</th><th className="n">{t.parts.loan}</th></tr></thead>
            <tbody>
              {groupParts.map((g) => {
                const b = Number(ipMap.get(g.id) ?? 0);
                return (
                  <tr key={g.id} className={g.id === id ? "hl-row" : ""}>
                    <td><Link className="link" href={`/projects/${g.id}`}>{g.code}</Link> · {g.name_ar}</td>
                    <td className="n num">{money(cashMap.get(g.id) ?? 0)}</td>
                    <td className="n num">{Math.abs(b) < 0.005 ? "—" : <b className={b < 0 ? "warn-text" : ""}>{b > 0 ? t.parts.owed : t.parts.owes} {money(Math.abs(b))}</b>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {manager && groupParts.some((g) => Number(ipMap.get(g.id) ?? 0) < -0.004) && (
            <form action={settleParts} className="stack mt">
              <h3>{t.parts.settle}</h3>
              <input type="hidden" name="id" value={id} />
              <div className="grid-3">
                <label className="field"><span>{t.parts.from}</span>
                  <select name="debtor">{groupParts.filter((g) => Number(ipMap.get(g.id) ?? 0) < -0.004).map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></label>
                <label className="field"><span>{t.parts.to}</span>
                  <select name="creditor">{groupParts.filter((g) => Number(ipMap.get(g.id) ?? 0) > 0.004).map((g) => <option key={g.id} value={g.id}>{g.code}</option>)}</select></label>
                <label className="field"><span>{t.cash.payAmount}</span><input name="amount" inputMode="decimal" dir="ltr" required /></label>
                <label className="field"><span>{t.parts.fromBank}</span>
                  <select name="from_account" defaultValue={bankOf(groupParts.find((g) => Number(ipMap.get(g.id) ?? 0) < -0.004)?.id)}>{(bankList ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_ar}</option>)}</select></label>
                <label className="field"><span>{t.parts.toBank}</span>
                  <select name="to_account" defaultValue={bankOf(groupParts.find((g) => Number(ipMap.get(g.id) ?? 0) > 0.004)?.id)}>{(bankList ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name_ar}</option>)}</select></label>
                <label className="field"><span>{t.cash.date}</span><input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              </div>
              <button className="btn soft self-start" data-act="settle-parts">{t.parts.settleBtn}</button>
            </form>
          )}
        </section>
      )}

      {role === "admin" && p.opening_cash != null && (
        <section className="card" id="opening">
          <div className="card-head"><h2>{t.op.title}</h2></div>
          {p.opening_adjusted_at ? (
            <dl className="kv">
              <div><dt>{t.op.opening}</dt><dd className="num">{money(p.opening_cash)}</dd></div>
              <div><dt>{t.op.diff}</dt><dd className="num">{money(p.opening_adjust_amount)}</dd></div>
              <div className="hl"><dt>{t.op.final}</dt><dd className="num">{money(Number(p.opening_cash) + Number(p.opening_adjust_amount))}</dd></div>
              <div><dt>{t.op.reason}</dt><dd>{p.opening_adjust_reason}</dd></div>
              <p className="muted small">🔒 {t.op.locked} <span className="num">{String(p.opening_adjusted_at).slice(0, 10)}</span></p>
            </dl>
          ) : (
            <form action={adjustOpening} className="stack">
              <input type="hidden" name="id" value={id} />
              <p className="muted small">{t.op.hint.replace("{amount}", money(p.opening_cash))}</p>
              <div className="grid-3">
                <label className="field"><span>{t.op.actual}<b className="req"> *</b></span>
                  <input name="actual" inputMode="decimal" dir="ltr" required defaultValue={String(p.opening_cash)} /></label>
                <label className="field"><span>{t.cash.date}</span>
                  <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                <label className="field"><span>{t.op.reason}<b className="req"> *</b></span><input name="reason" required /></label>
              </div>
              <p className="alert warn">{t.op.warn}</p>
              <button className="btn primary self-start" data-act="opening">{t.op.save}</button>
            </form>
          )}
        </section>
      )}

      {cf && (
        <section className="card">
          <h2>{closed ? t.pp.close : t.pp.closePreview}</h2>
          <div className="grid-2 top">
            <dl className="kv">
              <div><dt>{t.pp.revenue}</dt><dd className="num">{money(cf.revenue)}</dd></div>
              <div><dt>{t.pp.costs}</dt><dd className="num">({money(cf.costs)})</dd></div>
              <div className="hl"><dt>{t.pp.profit}</dt><dd className="num">{money(cf.profit)}</dd></div>
              <div><dt>{t.pp.share} <span className="num">{pct(cf.share_pct)}</span></dt><dd className="num">{money(cf.share)}</dd></div>
              {cf.settlement_to_company != null && (
                <div className="hl"><dt>{cf.settlement_to_company >= 0 ? t.pp.settlement : t.pp.settlementNeg}</dt>
                  <dd className="num">{money(Math.abs(cf.settlement_to_company))}</dd></div>
              )}
            </dl>
            <div className="stack">
              {!closed && (
                <>
                  <p className="muted small">{t.pp.closeWarn} {t.pp.lossNote}</p>
                  {cf.pending_documents > 0 && <p className="alert warn">{t.pp.pending}</p>}
                  <form action={projectAction} className="stack">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="close" />
                    <label className="field"><span>{t.pp.closeDate}</span>
                      <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                    <button className="btn primary" data-act="close" disabled={cf.pending_documents > 0}>{t.pp.closeBtn}</button>
                  </form>
                </>
              )}
              {closed && role === "admin" && (
                <form action={projectAction}>
                  <input type="hidden" name="id" value={id} /><input type="hidden" name="what" value="reopen" />
                  <button className="btn ghost danger" data-act="reopen">{t.pp.reopen}</button>
                </form>
              )}
            </div>
          </div>
        </section>
      )}

      {manager && prof && (
        <section className="card">
          <h2>{t.detail.profitability}</h2>
          <div className="kpis compact">
            <div className="kpi"><span className="kpi-label">{t.detail.revenue}</span><span className="kpi-value num">{money(prof.revenue)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.detail.directCosts}</span><span className="kpi-value num">{money(Number(prof.direct_costs) + advOpenP + cusOpenP)}</span>
              {advOpenP > 0.004 && <span className="kpi-sub warn-text">{t.exp.ofWhichAdv} {money(advOpenP)}</span>}
              {cusOpenP > 0.004 && <span className="kpi-sub warn-text">{t.exp.ofWhichCus} {money(cusOpenP)}</span>}</div>
            <div className="kpi"><span className="kpi-label">{t.detail.partnerCost}</span><span className="kpi-value num">{money(prof.partner_share_cost)}</span></div>
            <div className="kpi"><span className="kpi-label">{t.detail.grossProfit}</span><span className="kpi-value num">{money(Number(prof.gross_profit) - advOpenP - cusOpenP)}</span></div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>{t.detail.documents}</h2>
        {docs && docs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="link num" href={`/sales/${d.id}`}>{d.issuer_ref ?? "—"}</Link></td>
                    <td>{t.docType[d.doc_type as keyof typeof t.docType]}</td>
                    <td className="num">{d.issue_date}</td>
                    <td><span className={`chip ds-${d.status}`}>{t.docStatus[d.status as keyof typeof t.docStatus]}</span></td>
                    <td className="n num">{money(d.collectible_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t.sales.noDocs}</p>
        )}
      </section>
    </div>
  );
}
