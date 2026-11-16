// Usernames are stored in Supabase Auth as an internal e-mail: <username>@hisabat.local
export const USER_DOMAIN = "hisabat.local";

export function loginEmail(input: string): string {
  const v = input.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${USER_DOMAIN}`;
}

export function validUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u.trim().toLowerCase());
}

export function displayLogin(email: string | null | undefined): string {
  if (!email) return "";
  return email.endsWith(`@${USER_DOMAIN}`) ? email.slice(0, -USER_DOMAIN.length - 1) : email;
}
