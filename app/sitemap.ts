import type {MetadataRoute} from "next";
import {loadShows} from "../lib/show-data";
export const dynamic="force-dynamic";
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
 const now=new Date();
 const shows=await loadShows();
 const pages:MetadataRoute.Sitemap=[
  {url:"https://iextra.net",lastModified:now,changeFrequency:"daily",priority:1},
  {url:"https://iextra.net/gioi-thieu",lastModified:now,changeFrequency:"monthly",priority:0.4},
  {url:"https://iextra.net/lien-he",lastModified:now,changeFrequency:"monthly",priority:0.4}
 ];
 return [...pages,...shows.filter(show=>!["ended","hidden","pending"].includes(show.status)).map(show=>({url:"https://iextra.net/show/"+encodeURIComponent(show.id),lastModified:now,changeFrequency:"daily" as const,priority:0.9}))];
}
