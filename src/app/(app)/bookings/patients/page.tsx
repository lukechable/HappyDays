import { Suspense } from "react";
import { PatientsPage } from "@/components/bookings/patients-page";

export const metadata = { title: "Patients" };
export default function Page() { return <Suspense><PatientsPage /></Suspense>; }
