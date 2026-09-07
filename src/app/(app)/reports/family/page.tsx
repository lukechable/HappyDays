import { Suspense } from "react";
import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "Family reports" };
export default function Page() { return <Suspense><ReportsPage kind="family" /></Suspense>; }
