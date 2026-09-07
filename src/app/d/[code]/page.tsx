import { Suspense } from "react";
import { PublicDownload } from "@/components/files/public-download";

export const metadata = { title: "Download your document" };
export default async function Page({ params }: PageProps<"/d/[code]">) {
  const { code } = await params;
  return <Suspense><PublicDownload initialCode={code} /></Suspense>;
}
