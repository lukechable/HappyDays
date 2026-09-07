import { Suspense } from "react";
import { ReportsPage } from "@/components/reports/reports-page";

export const metadata = { title: "Therapy reports" };
export default function Page() { return <Suspense><ReportsPage kind="therapy" /></Suspense>; }
