import { Suspense } from "react";
import { PublicBooking } from "@/components/bookings/public-booking";

export const metadata = { title: "Book an appointment", robots: { index: true, follow: false } };
export default function Page() { return <Suspense><PublicBooking /></Suspense>; }
