"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/primitives";
export default function AppError({ reset }: { reset: () => void }) {
  return <div className="p-6"><Empty title="This page couldn’t load" body="The link may be out of date, or the service may be unavailable. Try again or return to the dashboard." action={<div className="flex gap-2"><Button onClick={reset}>Try again</Button><Button variant="outline" render={<Link href="/" />}>Dashboard</Button></div>} /></div>;
}
