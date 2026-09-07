import { Suspense } from "react";
import { CourtPage } from "@/components/court/court-page";

export const metadata = { title: "Court appearances" };
export default function Page() { return <Suspense><CourtPage kind="appearance" /></Suspense>; }
