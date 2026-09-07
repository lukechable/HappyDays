import { Suspense } from "react";
import { MatterDetail } from "@/components/matters/matter-detail";
import type { Id } from "../../../../../convex/_generated/dataModel";

export const metadata = { title: "Matter" };
export default async function Page({ params }: PageProps<"/matters/[id]">) {
  const { id } = await params;
  return <Suspense><MatterDetail id={id as Id<"matters">} /></Suspense>;
}
