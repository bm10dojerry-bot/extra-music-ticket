import {NextRequest} from "next/server";
import {handleFacebookPageCallback} from "../../../../../../lib/facebook-page-oauth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=120;
export async function GET(req:NextRequest){return handleFacebookPageCallback(req);}
