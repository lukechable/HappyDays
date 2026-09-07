import { Suspense } from "react";
import { TransactionsPage } from "@/components/money/transactions-page";

export const metadata = { title: "Transactions" };
export default function Page() { return <Suspense><TransactionsPage /></Suspense>; }
