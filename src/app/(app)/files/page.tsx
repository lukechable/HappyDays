import { Suspense } from "react";
import { FilesPage } from "@/components/files/files-page";

export const metadata = { title: "Send documents" };
export default function Page() { return <Suspense><FilesPage /></Suspense>; }
