import type { SupabaseClient } from "@supabase/supabase-js";

export type Line = {
  account_id: string; project_id: string | null; party_id: string | null; debit: number; credit: number;
  date: string; memo: string | null; type: string; key: string | null; code: string; name_ar: string; name_en: string | null;
};

const PAGE = 1000; // Supabase's default "max rows" per request

/**
 * All journal lines of the company between two dates (inclusive), with their account.
 * Fetched page by page: a single request is capped at 1,000 rows, and a report
 * built on a truncated ledger would show wrong totals without any error.
 */
export async function fetchLines(supabase: SupabaseClient, company: string, from?: string, to?: string): Promise<Line[]> {
  const out: Line[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from("journal_lines")
      .select("id,account_id,project_id,party_id,debit,credit,entry:journal_entries!inner(entry_date,memo),account:accounts!inner(type,system_key,code,name_ar,name_en)")
      .eq("company_id", company);
    if (from) q = q.gte("entry.entry_date", from);
    if (to) q = q.lte("entry.entry_date", to);
    const { data, error } = await q.order("id").range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const e = r.entry as unknown as { entry_date: string; memo: string | null };
      const a = r.account as unknown as { type: string; system_key: string | null; code: string; name_ar: string; name_en: string | null };
      out.push({ account_id: r.account_id, project_id: r.project_id, party_id: r.party_id, debit: Number(r.debit), credit: Number(r.credit),
                 date: e.entry_date, memo: e.memo, type: a.type, key: a.system_key, code: a.code, name_ar: a.name_ar, name_en: a.name_en });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}
