export const NAVIGATION = [
  {
    href: "/",
    label: "總覽",
    icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  },
  {
    href: "/holdings",
    label: "持倉",
    icon: "M3 7h18v13H3z M8 7V4h8v3 M3 12h18 M10 12v2h4v-2",
  },
  {
    href: "/calendar",
    label: "日曆",
    icon: "M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M8 14h2 M14 14h2 M8 17h2",
  },
  {
    href: "/trends",
    label: "趨勢",
    icon: "M3 4v16h18 M6 15l5-5 4 3 6-7",
  },
  {
    href: "/loans",
    label: "貸款",
    icon: "M3 8l9-5 9 5 M4 10h16 M6 10v7 M12 10v7 M18 10v7 M4 17h16 M3 21h18",
  },
] as const;

export function isActiveRoute(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}
