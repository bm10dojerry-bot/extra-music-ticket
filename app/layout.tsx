import type { ReactNode } from "react";
import "./globals.css";
import MessengerSupport from "./messenger-support";
import {OtherPublicPresence} from "./live-presence";
import GoogleAnalyticsTracking from "./google-analytics-tracking";
export const metadata={title:"Đặt vé | +1 Extra Music Show",description:"Khám phá các đêm nhạc và sơ đồ ghế tại Sa Pa, Lào Cai — +1 Extra Music Show."};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="vi"><body>{children}<MessengerSupport/><OtherPublicPresence/><GoogleAnalyticsTracking/></body></html>}
