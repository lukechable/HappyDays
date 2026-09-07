import { Suspense } from "react";
import { PublicSign } from "@/components/pdf/public-sign";

export const metadata = { title: "Sign document" };
export default async function Page({ params }: PageProps<"/sign/[token]">) {
  const { token } = await params;
  return <Suspense><PublicSign token={token} /></Suspense>;
}
