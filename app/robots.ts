import type {MetadataRoute} from "next";
export default function robots():MetadataRoute.Robots{
 return {rules:[{userAgent:"*",allow:"/",disallow:["/admin/","/staff/","/sale/","/checkin/","/api/","/ve/"]}],sitemap:"https://iextra.net/sitemap.xml"};
}
