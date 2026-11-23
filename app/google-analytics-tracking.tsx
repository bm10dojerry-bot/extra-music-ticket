"use client";

import {useEffect} from "react";
import {usePathname} from "next/navigation";
import {
 isPublicMeasurementPage,sendInitialGooglePageView,setGoogleAnalyticsDisabled,
 useGlobalMeasurementId,useMeasurementConsent,
} from "../lib/measurement-client";
import styles from "./google-analytics-tracking.module.css";

export default function GoogleAnalyticsTracking(){
 const pathname=usePathname();
 const {measurementId}=useGlobalMeasurementId(pathname);
 const [consent,chooseConsent]=useMeasurementConsent();

 useEffect(()=>{
  const allowed=consent==="yes"&&Boolean(pathname)&&isPublicMeasurementPage(window.location.hostname,pathname||"");
  setGoogleAnalyticsDisabled(!allowed);
  if(allowed&&measurementId)sendInitialGooglePageView(measurementId);
 },[consent,measurementId,pathname]);

 // Show pages already present their own chooser, using the same consent store.
 // No configured stream means no new banner and no Google script.
 if(!measurementId||consent!==null||!pathname||!isPublicMeasurementPage("",pathname)||pathname.startsWith("/show/"))return null;
 return <section className={styles.banner} role="region" aria-labelledby="measurement-consent-title">
  <h2 id="measurement-consent-title">Quyền riêng tư của bạn</h2>
  <p>EXTRA chỉ dùng Google Analytics khi bạn đồng ý, để thống kê lượt truy cập và khu vực ở mức tổng hợp. Từ chối không ảnh hưởng đến việc đặt vé. <a href="/chinh-sach-quyen-rieng-tu">Tìm hiểu thêm</a></p>
  <div className={styles.actions}>
   <button type="button" onClick={()=>chooseConsent("no")}>Không đồng ý</button>
   <button type="button" className={styles.accept} onClick={()=>chooseConsent("yes")}>Đồng ý</button>
  </div>
 </section>;
}
