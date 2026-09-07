import { Suspense } from "react";
import { MailPage } from "@/components/mail/mail-page";

export const metadata = { title: "Mail" };
export default function Page() { return <Suspense><MailPage /></Suspense>; }
