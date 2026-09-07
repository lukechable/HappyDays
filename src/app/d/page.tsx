import { Suspense } from "react";
import { PublicDownload } from "@/components/files/public-download";

export const metadata = { title: "Download your document" };
export default function Page() { return <Suspense><PublicDownload /></Suspense>; }
