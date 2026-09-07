import { Suspense } from "react";
import { PdfWorkbench } from "@/components/pdf/pdf-workbench";

export const metadata = { title: "PDF tools" };
export default function Page() { return <Suspense><PdfWorkbench /></Suspense>; }
