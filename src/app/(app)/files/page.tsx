import { Suspense } from "react";
import { FilesPage } from "@/components/files/files-page";

export const metadata = { title: "Files & codes" };
export default function Page() { return <Suspense><FilesPage /></Suspense>; }
