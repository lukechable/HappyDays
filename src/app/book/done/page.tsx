import { Suspense } from "react";
import { BookingDone } from "@/components/bookings/public-booking";

export const metadata = { title: "Booking confirmed" };
export default function Page() { return <Suspense><BookingDone /></Suspense>; }
