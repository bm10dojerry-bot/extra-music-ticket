import { notFound } from "next/navigation";
import Extra21Demo from "./demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Sale Extra 2.1 - Test | +1 Extra", robots: { index: false, follow: false } };
export default function Page() {
  // This playground is never accessible if accidentally shipped to production.
  if (process.env.VERCEL_ENV === "production") notFound();
  return <Extra21Demo />;
}
