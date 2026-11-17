import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pages show live accounting data: never keep an old copy in the browser (incl. the back button)
  async headers() {
    return [{ source: "/((?!_next/static|_next/image|favicon).*)", headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }] }];
  },
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};
export default nextConfig;
