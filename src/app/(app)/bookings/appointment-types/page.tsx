import { Suspense } from "react";
import { AppointmentTypesPage } from "@/components/bookings/appointment-types-page";

export const metadata = { title: "Appointment types" };
export default function Page() { return <Suspense><AppointmentTypesPage /></Suspense>; }
