import { Suspense } from "react";
import { MoneyPage } from "@/components/money/money-page";

export const metadata = { title: "Invoices & reports" };
export default function Page() { return <Suspense><MoneyPage /></Suspense>; }
