import {NextResponse} from "next/server";
import {loadShows} from "../../../../lib/show-data";
export const dynamic="force-dynamic";
export async function GET(){const shows=await loadShows();return NextResponse.json({shows},{headers:{"Cache-Control":"no-store"}})}
