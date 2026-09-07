import { Suspense } from "react";
import { FileView } from "@/components/files/file-view";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const metadata = { title: "File" };
export default async function Page({ params }: PageProps<"/files/[id]">) {
  const { id } = await params;
  return <Suspense><FileView id={id as Id<"files">} /></Suspense>;
}
