/**
 * Rail navigation. Badges are keyed to `users.me().badges`. Blurbs double as ⌘K subtitles.
 * Query values are written the way URLSearchParams serialises them (":" as %3A) so `isActive` and the router's
 * prefetch cache see the same string as the address bar.
 */
export type NavItem = { href: string; label: string; badge?: "assigned" | "tasks" | "overdue" | "notifications" | "paidNotDelivered"; blurb: string; exact?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Today",
    items: [
      { href: "/", label: "Dashboard", exact: true, blurb: "Today's appointments, overdue mail, tasks due and money at a glance." },
      { href: "/bookings", label: "Appointments", exact: true, blurb: "The Cliniko appointments calendar, read live. Drag to reschedule, click to book." },
    ],
  },
  {
    label: "Mail",
    items: [
      { href: "/mail", label: "Inbox", exact: true, blurb: "Your Gmail inbox, newest first." },
      { href: "/mail?view=overdue", label: "Overdue", badge: "overdue", blurb: "Threads both of you are on that nobody has answered." },
      { href: "/mail?view=assigned", label: "Assigned to me", badge: "assigned", blurb: "Follow-ups the other person handed you." },
      { href: "/matters", label: "Subpoena Export", blurb: "One record per court matter: emails, tasks, files, invoices, exported for a subpoena." },
    ],
  },
  { label: "Work", items: [{ href: "/tasks", label: "Tasks", badge: "tasks", blurb: "Your lists, due today and this week, assigned to you." }] },
  {
    label: "Court Matters",
    items: [
      { href: "/court/affidavits", label: "Affidavit Requests", blurb: "Affidavits solicitors have asked for: who wants them, when they are due, where each one is up to." },
      { href: "/court/appearances", label: "Court Appearances", blurb: "Hearings, mentions and trials you must attend, with the court, the matter and the date." },
    ],
  },
  {
    label: "Cliniko Link",
    items: [
      { href: "/bookings/patients", label: "Patients", blurb: "Search Cliniko patients; open a record, its appointments and files." },
      { href: "/bookings/appointment-types", label: "Appointment Types", blurb: "Every Cliniko appointment type with its colour, length and online price." },
      { href: "/bookings/payments", label: "Payments", blurb: "Cliniko invoices and Stripe payments side by side." },
    ],
  },
  {
    label: "Documents",
    items: [
      { href: "/files", label: "Send Documents", blurb: "Zip, encrypt and email documents with a read receipt; stored files and download codes." },
      { href: "/pdf", label: "PDF tools", blurb: "Sign, mark up, rearrange and merge PDFs; send for signature." },
    ],
  },
  {
    label: "Reports",
    items: [
      { href: "/reports/therapy", label: "Therapy Reports", blurb: "Therapy reports the practice has written: matter, delivery and sending." },
      { href: "/reports/family", label: "Family Reports", blurb: "Family reports for the court: matter, delivery and sending." },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/money", label: "Invoices", exact: true, badge: "paidNotDelivered", blurb: "Every Stripe invoice and whether its report has gone out." },
      { href: "/money/transactions", label: "Transactions", blurb: "Every payment and invoice payment through Stripe, as one ledger." },
    ],
  },
  { label: "Settings", items: [{ href: "/settings", label: "Settings", blurb: "Google, Cliniko, Stripe, signatures, tags, auto-replies." }] },
];

export const NAV_ITEMS = NAV.flatMap((g) => g.items);
const pathOf = (href: string) => href.split("?")[0];

export function navItemFor(pathname: string, search: string): NavItem {
  const full = `${pathname}${search}`;
  return NAV_ITEMS.find((i) => i.href === full) ?? NAV_ITEMS.filter((i) => !i.exact && pathname.startsWith(pathOf(i.href)) && !i.href.includes("?")).sort((a, b) => b.href.length - a.href.length)[0] ?? NAV_ITEMS.find((i) => pathOf(i.href) === pathname) ?? NAV_ITEMS[0];
}

export function isActive(item: NavItem, pathname: string, search: string): boolean {
  if (item.exact) return pathname === pathOf(item.href) && (item.href.includes("?") || !search.includes("view="));
  if (item.href.includes("?")) return `${pathname}${search}` === item.href || (`${pathname}${search}`).startsWith(item.href);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}
