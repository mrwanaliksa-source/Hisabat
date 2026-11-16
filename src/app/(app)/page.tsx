import Link from "next/link";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

type TB = { account_id: string; balance: number };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  const manager = canManage(role);

  const shortcuts = (
    <section className="shortcuts">
      {manager && <Link href="/sales/new" className="btn primary"><Icon name="plus" /> {t.shortcuts.addInvoice}</Link>}
      {(manager || role === "expense") && <Link href="/purchases/new" className="btn primary"><Icon name="camera" /> {t.shortcuts.captureExpense}</Link>}
      {manager && <Link href="/cash/receipt/new" className="btn soft"><Icon name="in" /> {t.shortcuts.receipt}</Link>}
      {manager && <Link href="/purchases?unpaid=1" className="btn soft"><Icon name="out" /> {t.shortcuts.payment}</Link>}
      {role !== "entry" && <Link href="/custody?new=1" className="btn soft"><Icon name="plus" /> {t.cus.request}</Link>}
      {role === "entry" && <Link href="/sales/new" className="btn primary"><Icon name="plus" /> {t.shortcuts.addInvoice}</Link>}
    </section>
  );

  // limited roles: shortcuts only (and a plain project list for data entry)
  if (!manager) {
    const { data: projects } = role === "entry"
      ? await supabase.from("projects").select("id,code,name_ar,name_en").eq("company_id", company.id).neq("status", "closed").order("code")
      : { data: null };
    return (
      <div className="stack-lg">
        <h1 className="page-title">{t.dashboard}</h1>
        {shortcuts}
        {projects && projects.length > 0 && (
          <section className="card"><h2>{t.projects}</h2>
            <ul className="plain-list">{projects.map((p) => <li key={p.id}><Link className="link" href={`/projects/${p.id}`}>
              <span className="num">{p.code}</span> · {(lang === "en" && p.name_en) || p.name_ar}</Link></li>)}</ul>
          </section>
        )}
      </div>
    );
  }

  const [{ data: projects }, { data: prof }, { data: advret }, { data: docs }, { data: held }, { data: tb }, { data: accts },
         { data: custodies }, { data: payables }, { data: agreements }] = await Promise.all([
    supabase.from("projects").select("id,code,name_ar,name_en,status,contract_value,contract_holder,customer:parties!projects_customer_id_fkey(name_ar,name_en)")
      .eq("company_id", company.id).order("code"),
    supabase.from("v_project_profitability").select("project_id,revenue,direct_costs,partner_share_cost,gross_profit").eq("company_id", company.id),
    supabase.from("v_project_advance_retention").select("project_id,works_certified,advance_outstanding,retention_outstanding").eq("company_id", company.id),
    supabase.from("v_sales_document_balances").select("id,project_id,collectible_total,collected,balance").eq("company_id", company.id).eq("status", "posted"),
    supabase.from("v_partner_project_accounts").select("project_id,net_due_to_company").eq("company_id", company.id),
    supabase.from("v_trial_balance").select("account_id,balance").eq("company_id", company.id),
    supabase.from("accounts").select("id,system_key,is_bank,code,name_ar,name_en").eq("company_id", company.id),
    supabase.from("v_custody").select("balance").eq("company_id", company.id).eq("status", "open"),
    supabase.from("v_purchase_balances").select("balance").eq("company_id", company.id).gt("balance", 0),
    supabase.from("partner_agreements").select("project_id,share_pct,basis").eq("company_id", company.id),
  ]);
  const { data: nets } = await supabase.from("sales_documents").select("id,project_id,collectible_net,collectible_total")
    .eq("company_id", company.id).eq("status", "posted");
  const netRatio = new Map((nets ?? []).map((x) => [x.id, Number(x.collectible_total) > 0 ? Number(x.collectible_net) / Number(x.collectible_total) : 0]));

  // company-wide strip: things that only make sense for the whole company
  const bal = new Map(((tb ?? []) as TB[]).map((r) => [r.account_id, Number(r.balance)]));
  const byKey = (k: string) => (accts ?? []).filter((a) => a.system_key === k).reduce((s, a) => s + (bal.get(a.id) ?? 0), 0);
  const banks = (accts ?? []).filter((a) => a.is_bank).sort((a, b) => a.code.localeCompare(b.code));
  const companyKpis = [
    ...banks.map((b) => ({ label: (lang === "en" && b.name_en) || b.name_ar, value: bal.get(b.id) ?? 0, icon: "cash" })),
    { label: t.kpi.vat, value: -byKey("vat_output") - byKey("vat_input"), icon: "sales" },
    { label: t.dash.payables, value: (payables ?? []).reduce((s, x) => s + Number(x.balance), 0), icon: "out" },
    { label: t.dash.custodyOpen, value: (custodies ?? []).reduce((s, x) => s + Number(x.balance), 0), icon: "camera" },
  ];

  const P = new Map((prof ?? []).map((x) => [x.project_id, x]));
  const A = new Map((advret ?? []).map((x) => [x.project_id, x]));
  const H = new Map((held ?? []).map((x) => [x.project_id, Number(x.net_due_to_company)]));
  const G = new Map((agreements ?? []).map((x) => [x.project_id, x]));
  const D = new Map<string, { billed: number; collected: number; due: number; collectedNet: number }>();
  for (const d of docs ?? []) {
    const cur = D.get(d.project_id) ?? { billed: 0, collected: 0, due: 0, collectedNet: 0 };
    cur.billed += Number(d.collectible_total); cur.collected += Number(d.collected); cur.due += Number(d.balance);
    cur.collectedNet += Number(d.collected) * (netRatio.get(d.id) ?? 0);
    D.set(d.project_id, cur);
  }
  const all = projects ?? [];
  const visible = all.filter((p) => sp.closed || p.status !== "closed");
  const closedCount = all.filter((p) => p.status === "closed").length;
  type N = { name_ar: string; name_en: string | null } | null;

  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.dashboard}</h1>
      {shortcuts}

      <section className="stack">
        <h2 className="section-title">{t.dash.company}</h2>
        <div className="kpis compact-row">
          {companyKpis.map((k) => (
            <div key={k.label} className="kpi">
              <span className="kpi-label"><Icon name={k.icon} size={16} /> {k.label}</span>
              <span className={`kpi-value num ${k.value < 0 ? "neg" : ""}`}>{money(k.value)} <small>{t.sar}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="card-head">
          <h2 className="section-title">{t.dash.projects}</h2>
          <div className="actions">
            {closedCount > 0 && (
              <Link className="link small" href={sp.closed ? "/" : "/?closed=1"}>{sp.closed ? "✓ " : ""}{t.dash.showClosed} ({closedCount})</Link>
            )}
            <Link href="/projects/new" className="btn soft sm"><Icon name="plus" size={16} /> {t.newProject}</Link>
          </div>
        </div>

        {visible.length === 0 && <div className="card empty"><p className="muted">{t.dash.noProjects}</p></div>}
        <div className="project-cards">
          {visible.map((p) => {
            const f = P.get(p.id), a = A.get(p.id), d = D.get(p.id) ?? { billed: 0, collected: 0, due: 0, collectedNet: 0 }, g = G.get(p.id);
            const netCash = d.collectedNet - Number(f?.direct_costs ?? 0) - Number(f?.partner_share_cost ?? 0);
            const contract = Number(p.contract_value), certified = Number(a?.works_certified ?? 0);
            const progress = contract > 0 ? Math.min(100, (certified / contract) * 100) : 0;
            const profit = Number(f?.gross_profit ?? 0);
            const cust = p.customer as unknown as N;
            const partnerHeld = p.contract_holder === "partner";
            const profitBasisOpen = g?.basis === "profit_at_close" && p.status !== "closed";
            return (
              <Link key={p.id} href={`/projects/${p.id}`} className={`card project-card ${p.status === "closed" ? "is-closed" : ""}`}>
                <div className="pc-head">
                  <div>
                    <span className="num eyebrow">{p.code}</span>
                    <b className="pc-name">{(lang === "en" && p.name_en) || p.name_ar}</b>
                    <span className="muted small">{cust ? (lang === "en" && cust.name_en) || cust.name_ar : ""}</span>
                  </div>
                  <div className="chips">
                    {partnerHeld && <span className="chip tiny">{t.dash.partnerHeld}</span>}
                    {p.status !== "active" && <span className={`chip tiny st-${p.status}`}>{t.status[p.status as keyof typeof t.status]}</span>}
                  </div>
                </div>

                <div className="pc-progress">
                  <div className="bar"><i style={{ width: `${progress}%` }} /></div>
                  <span className="small"><b className="num">{progress.toFixed(0)}%</b> · {t.dash.certified} <span className="num">{money(certified)}</span> {t.dash.of} <span className="num">{money(contract)}</span></span>
                </div>

                <dl className="pc-grid">
                  <div><dt>{t.dash.collected}</dt><dd className="num">{money(d.collected)}</dd></div>
                  <div className={d.due > 0.004 ? "warn" : ""}><dt>{t.dash.due}</dt><dd className="num">{money(d.due)}</dd></div>
                  <div><dt>{t.dash.costs}</dt><dd className="num">{money(f?.direct_costs ?? 0)}</dd></div>
                  <div><dt>{t.dash.share}{profitBasisOpen ? " *" : ""}</dt><dd className="num">{money(f?.partner_share_cost ?? 0)}</dd></div>
                  {Number(a?.advance_outstanding ?? 0) > 0 && <div><dt>{t.dash.advLeft}</dt><dd className="num">{money(a?.advance_outstanding)}</dd></div>}
                  {Number(a?.retention_outstanding ?? 0) > 0 && <div><dt>{t.dash.retLeft}</dt><dd className="num">{money(a?.retention_outstanding)}</dd></div>}
                  {partnerHeld && <div className="hl"><dt>{t.dash.atPartner}</dt><dd className="num">{money(H.get(p.id) ?? 0)}</dd></div>}
                </dl>

                <div className={`pc-profit ${profit < 0 ? "neg" : ""}`}>
                  <span>{t.dash.profit}</span><b className="num">{money(profit)} <small>{t.sar}</small></b>
                </div>
                {!partnerHeld && (
                  <div className={`pc-cash ${netCash < 0 ? "neg" : ""}`} title={t.dash.cashHint}>
                    <span>{t.dash.cash}</span><b className="num">{money(netCash)} <small>{t.sar}</small></b>
                  </div>
                )}
                {!partnerHeld && Number(a?.advance_outstanding ?? 0) > 0 && profit < 0 && <p className="muted tiny-note">{t.dash.cashHint}</p>}
                {profitBasisOpen && <p className="muted tiny-note">* {t.pp.profitNote}</p>}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
