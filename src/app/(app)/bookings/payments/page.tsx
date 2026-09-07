import { Suspense } from "react";
import { PaymentsPage } from "@/components/bookings/payments-page";

export const metadata = { title: "Payments" };
export default function Page() { return <Suspense><PaymentsPage /></Suspense>; }
