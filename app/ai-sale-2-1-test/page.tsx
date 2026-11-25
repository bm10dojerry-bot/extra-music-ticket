import { notFound } from "next/navigation";
import { readMessengerSeatMap } from "../../lib/messenger-seatmap-files";
import Extra21Demo from "./demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Sale Extra 2.1 - Test | +1 Extra", robots: { index: false, follow: false } };
export default async function Page() {
  // This playground is never accessible if accidentally shipped to production.
  if (process.env.VERCEL_ENV === "production") notFound();
  const venues = ["ccc", "laocai"] as const;
  const available = await Promise.all(venues.map(readMessengerSeatMap));
  return <Extra21Demo availableMaps={venues.filter((_, i) => Boolean(available[i]))} />;
}
