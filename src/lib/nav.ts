/** Rail navigation. Badges are keyed to `users.me().badges`. Blurbs double as ⌘K subtitles. */
export type NavItem = { href: string; label: string; badge?: "assigned" | "tasks" | "overdue" | "notifications" | "paidNotDelivered"; blurb: string; exact?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "Today", items: [{ href: "/", label: "Dashboard", exact: true, blurb: "Today's appointments, overdue mail, tasks due and money at a glance." }] },
  {
    label: "Mail",
    items: [
      { href: "/mail", label: "Inbox", exact: true, blurb: "Your Gmail inbox, newest first." },
      { href: "/mail?view=unread", label: "Unread", blurb: "Only what you haven't read." },
      { href: "/mail?view=smart:primary", label: "Smart", blurb: "Primary, newsletters, notifications and social, separated." },
      { href: "/mail?view=overdue", label: "Overdue", badge: "overdue", blurb: "Threads both of you are on that nobody has answered." },
      { href: "/mail?view=assigned", label: "Assigned to me", badge: "assigned", blurb: "Follow-ups the other person handed you." },
      { href: "/matters", label: "Matters", blurb: "Court matters: emails, tasks, files, invoices and subpoena export." },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/tasks", label: "Tasks", badge: "tasks", blurb: "Your lists, due today and this week, assigned to you." },
      { href: "/bookings", label: "Bookings", blurb: "Cliniko calendar and patients, paid through Stripe." },
    ],
  },
  {
    label: "Documents",
    items: [
      { href: "/files", label: "Files & codes", blurb: "Reports for delivery and their download codes." },
      { href: "/pdf", label: "PDF tools", blurb: "Sign, mark up, rearrange and merge PDFs; send for signature." },
    ],
  },
  { label: "Money", items: [{ href: "/money", label: "Invoices & reports", badge: "paidNotDelivered", blurb: "Which invoices are paid and which reports are delivered." }] },
  { label: "Settings", items: [{ href: "/settings", label: "Settings", blurb: "Google, Cliniko, Stripe, signatures, tags, auto-replies." }] },
];

export const NAV_ITEMS = NAV.flatMap((g) => g.items);
const pathOf = (href: string) => href.split("?")[0];

export function navItemFor(pathname: string, search: string): NavItem {
  const full = `${pathname}${search}`;
  return NAV_ITEMS.find((i) => i.href === full) ?? NAV_ITEMS.filter((i) => !i.exact && pathname.startsWith(pathOf(i.href)) && !i.href.includes("?")).sort((a, b) => b.href.length - a.href.length)[0] ?? NAV_ITEMS.find((i) => pathOf(i.href) === pathname) ?? NAV_ITEMS[0];
}

export function isActive(item: NavItem, pathname: string, search: string): boolean {
  if (item.exact) return pathname === pathOf(item.href) && (!item.href.includes("?") ? !search.includes("view=") : true);
  if (item.href.includes("?")) return `${pathname}${search}` === item.href || (`${pathname}${search}`).startsWith(item.href);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
