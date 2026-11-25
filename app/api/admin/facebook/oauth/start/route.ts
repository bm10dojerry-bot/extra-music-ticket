import {NextRequest} from "next/server";
import {startFacebookPageAuthorization} from "../../../../../../lib/facebook-page-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:NextRequest){return startFacebookPageAuthorization(req);}
