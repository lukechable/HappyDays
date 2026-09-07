import { Suspense } from "react";
import { PatientPanel } from "@/components/bookings/patient-panel";

export const metadata = { title: "Patient" };
export default async function Page({ params }: PageProps<"/bookings/patients/[id]">) {
  const { id } = await params;
  return <Suspense><PatientPanel patientId={id} /></Suspense>;
}
