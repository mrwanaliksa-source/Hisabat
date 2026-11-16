import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang, money } from "@/lib/i18n";
import { payPartner } from "./actions";

type SP = Promise<{ partner?: string; project?: string; err?: string }>;

export default async function PartnerPay({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict(lang);
  const { supabase, company, role } = await getContext();
  if (!company) return null;
  if (!canManage(role) || !sp.partner) redirect("/cash");

  const [{ data: bal }, { data: partner }, { data: project }, { data: banks }, { data: ents }] = await Promise.all([
    supabase.from("v_partner_balances").select("*").eq("partner_id", sp.partner).eq("project_id", sp.project ?? "").maybeSingle(),
    supabase.from("parties").select("name_ar,name_en").eq("id", sp.partner).maybeSingle(),
    supabase.from("projects").select("code,name_ar,name_en").eq("id", sp.project ?? "").maybeSingle(),
    supabase.from("accounts").select("id,code,name_ar,name_en").eq("company_id", company.id).eq("is_bank", true).order("code"),
    supabase.from("partner_entitlements").select("id,created_at,collected_amount,net_collected,amount,doc:sales_documents(issuer_ref,doc_type)")
      .eq("partner_id", sp.partner).eq("project_id", sp.project ?? "").is("reversed_at", null).order("created_at"),
  ]);
  const nm = (x: { name_ar: string; name_en: string | null } | null) => (x ? (lang === "en" && x.name_en) || x.name_ar : "—");

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <p className="eyebrow num">{project?.code}</p>
          <h1 className="page-title">{t.cash.payPartner}: {nm(partner)}</h1>
        </div>
        <Link href="/cash" className="btn ghost">{t.back}</Link>
      </div>
      {sp.err && <p className="alert error">{sp.err}</p>}

      <div className="grid-2 top">
        <form action={payPartner} className="card stack">
          <input type="hidden" name="partner" value={sp.partner} />
          <input type="hidden" name="project" value={sp.project ?? ""} />
          <dl className="kv">
            <div><dt>{t.detail.entitled}</dt><dd className="num">{money(bal?.entitled)}</dd></div>
            <div><dt>{t.detail.settled}</dt><dd className="num">{money(bal?.settled)}</dd></div>
            <div className="hl"><dt>{t.cash.outstanding}</dt><dd className="num">{money(bal?.outstanding)}</dd></div>
          </dl>
          <label className="field"><span>{t.cash.payAmount}</span>
            <input name="amount" inputMode="decimal" dir="ltr" required defaultValue={bal?.outstanding ?? ""} /></label>
          <label className="field"><span>{t.cash.date}</span>
            <input type="date" name="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label className="field"><span>{t.cash.bank}</span>
            <select name="bank">{(banks ?? []).map((b) => <option key={b.id} value={b.id}>{b.code} · {nm(b)}</option>)}</select></label>
          <label className="field"><span>{t.cash.reference}</span><input name="reference" dir="ltr" /></label>
          <button className="btn primary">{t.cash.payPartner}</button>
        </form>

        <section className="card">
          <h2>{t.sales.partnerShares}</h2>
          <table>
            <thead><tr><th>{t.sales.issuerRef}</th><th className="n">{t.sales.collected}</th><th className="n">{t.form.netDue}</th><th className="n">{t.detail.entitled}</th></tr></thead>
            <tbody>
              {(ents ?? []).map((e) => {
                const d = e.doc as unknown as { issuer_ref: string | null; doc_type: string };
                return (
                  <tr key={e.id}>
                    <td><span className="num">{d?.issuer_ref ?? "—"}</span> <span className="muted small">{t.docType[d?.doc_type as keyof typeof t.docType]}</span></td>
                    <td className="n num">{money(e.collected_amount)}</td><td className="n num">{money(e.net_collected)}</td>
                    <td className="n num"><b>{money(e.amount)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
