import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// sets the active company after checking the user is an active member
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { data: m } = await supabase.from("memberships").select("company_id")
    .eq("user_id", user.id).eq("company_id", id).eq("is_active", true).maybeSingle();
  if (!m) return NextResponse.redirect(new URL("/choose-company?denied=1", req.url));
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set("company", id, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
