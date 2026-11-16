"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";

export type NavItem = { href: string; label: string; icon: string; ready: boolean };

export function Sidebar({ items, appName }: { items: NavItem[]; appName: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="menu-btn" onClick={() => setOpen(!open)} aria-label="menu"><Icon name="menu" /></button>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden><i /><i /><i /></span>
          <span><b>حسابات</b><small>Hisabat</small></span>
        </div>
        <nav>
          {items.map((it) => {
            const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
            return (
              <Link key={it.href} href={it.href} className={active ? "active" : ""} onClick={() => setOpen(false)}>
                <Icon name={it.icon} />
                <span>{it.label}</span>
                {!it.ready && <em className="soon-dot" title="…" />}
              </Link>
            );
          })}
        </nav>
        <p className="sidebar-foot">{appName} · v0.1</p>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
    </>
  );
}
