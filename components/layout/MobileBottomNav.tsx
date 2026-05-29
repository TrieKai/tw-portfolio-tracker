"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "總覽", match: (p: string) => p === "/" },
  { href: "/holdings", label: "持倉", match: (p: string) => p === "/holdings" },
  { href: "/holdings/new", label: "新增", match: (p: string) => p === "/holdings/new" },
  { href: "/trends", label: "趨勢", match: (p: string) => p.startsWith("/trends") },
] as const;

/** 手機版底部導覽（md 以上隱藏） */
export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-page/95 backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="主要導覽"
    >
      <div className="mx-auto flex max-w-6xl">
        {TABS.map(({ href, label, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition touch-target ${
                active
                  ? "text-accent"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span
                className={`h-1 w-8 rounded-full ${
                  active ? "bg-accent" : "bg-transparent"
                }`}
                aria-hidden
              />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
