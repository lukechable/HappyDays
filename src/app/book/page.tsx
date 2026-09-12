import { redirect } from "next/navigation";
import { convexPublic } from "@/lib/convex-server";
import { api } from "../../../convex/_generated/api";

export const metadata = { title: "Book an appointment", robots: { index: true, follow: false } };
export const dynamic = "force-dynamic";
export default async function Page() {
  const { url } = await convexPublic().query(api.bookings.publicBookingLink, {});
  redirect(url);
}
