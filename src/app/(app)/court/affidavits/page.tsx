import { Suspense } from "react";
import { CourtPage } from "@/components/court/court-page";

export const metadata = { title: "Affidavit requests" };
export default function Page() { return <Suspense><CourtPage kind="affidavit" /></Suspense>; }
