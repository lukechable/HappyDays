import { Suspense } from "react";
import { CalendarPage } from "@/components/bookings/calendar-page";

export const metadata = { title: "Bookings" };
export default function Page() { return <Suspense><CalendarPage /></Suspense>; }
