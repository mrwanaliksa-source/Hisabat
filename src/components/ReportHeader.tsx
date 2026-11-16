import Link from "next/link";
import { ReportTools } from "./ReportTools";
import type { Dict } from "@/lib/i18n";

type Props = {
  t: Dict; title: string; name: string; desc?: string;
  range?: { from: string; to: string }; asOf?: string; extra?: React.ReactNode;
};

/** Title, date filter (GET form, so the URL can be bookmarked) and export/print buttons. */
export function ReportHeader({ t, title, name, desc, range, asOf, extra }: Props) {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow no-print"><Link href="/reports">{t.rep.title}</Link></p>
          <h1 className="page-title">{title}</h1>
          {desc && <p className="muted">{desc}</p>}
        </div>
        <ReportTools name={name} exportLabel={t.rep.export} printLabel={t.rep.print} />
      </div>
      {(range || asOf !== undefined || extra) && (
        <form className="filters no-print" method="get">
          {range && (
            <>
              <label className="field"><span>{t.rep.from}</span><input type="date" name="from" defaultValue={range.from} /></label>
              <label className="field"><span>{t.rep.to}</span><input type="date" name="to" defaultValue={range.to} /></label>
            </>
          )}
          {asOf !== undefined && (
            <label className="field"><span>{t.rep.asOf}</span><input type="date" name="to" defaultValue={asOf} /></label>
          )}
          {extra}
          <button className="btn primary sm">{t.rep.apply}</button>
        </form>
      )}
      {range && <p className="print-only muted">{t.rep.from} <span className="num">{range.from}</span> {t.rep.to} <span className="num">{range.to}</span></p>}
      {asOf !== undefined && <p className="print-only muted">{t.rep.asOf} <span className="num">{asOf}</span></p>}
    </div>
  );
}
