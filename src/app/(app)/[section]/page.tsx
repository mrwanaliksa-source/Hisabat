import { notFound } from "next/navigation";
import { dict, getLang } from "@/lib/i18n";
import { Icon } from "@/components/Icon";

const SECTIONS = ["reports"] as const;
type Section = (typeof SECTIONS)[number];

export default async function SoonPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!SECTIONS.includes(section as Section)) notFound();
  const t = dict(await getLang());
  return (
    <div className="stack-lg">
      <h1 className="page-title">{t.nav[section as Section]}</h1>
      <div className="card empty">
        <span className="kpi-icon big"><Icon name={section} size={28} /></span>
        <h2>{t.soon}</h2>
        <p className="muted">{t.soonText}</p>
      </div>
    </div>
  );
}
