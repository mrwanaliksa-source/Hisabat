import Link from "next/link";
import { redirect } from "next/navigation";
import { getContext, canManage } from "@/lib/context";
import { dict, getLang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

export default async function ReportsIndex() {
  const t = dict(await getLang());
  const { role } = await getContext();
  if (!canManage(role)) redirect("/");
  const items: [string, { t: string; d: string }, string][] = [
    ["profit", t.rep.profit, "reports"], ["vat", t.rep.vat, "sales"], ["aging", t.rep.aging, "in"],
    ["payables", t.rep.payables, "out"], ["advances", t.rep.adv, "projects"], ["partners", t.rep.partners, "projects"],
    ["custody", t.rep.custody, "camera"], ["trial-balance", t.rep.tb, "review"], ["ledger", t.rep.ledger, "cash"],
  ];
  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.rep.title}</h1>
      <div className="report-grid">
        {items.map(([slug, r, icon]) => (
          <Link key={slug} href={`/reports/${slug}`} className="card report-card">
            <span className="kpi-icon"><Icon name={icon} /></span>
            <b>{r.t}</b>
            <span className="muted small">{r.d}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
