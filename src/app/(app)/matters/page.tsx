import { Suspense } from "react";
import { MattersList } from "@/components/matters/matters-list";

export const metadata = { title: "Subpoena export" };
export default function Page() { return <Suspense><MattersList /></Suspense>; }
