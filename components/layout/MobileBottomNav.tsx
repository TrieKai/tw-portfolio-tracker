"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveRoute, NAVIGATION } from "./navigation";

/** 手機版底部導覽（md 以上隱藏） */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="主要導覽"
    >
      <div className="grid grid-cols-5 gap-1 px-2 py-1">
        {NAVIGATION.map(({ href, label, icon }) => {
          const active = isActiveRoute(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? (pathname === href ? "page" : "location") : undefined}
              className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium ${
                active ? "bg-accent-dim text-accent" : "text-muted hover:bg-surface-raised hover:text-foreground"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
