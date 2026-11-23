"use client";

import {useEffect,useRef} from "react";
import {getStageMotion,getStageProgress} from "./stage-hero-motion";
import styles from "./stage-hero.module.css";

const particles=Array.from({length:8},(_,index)=>index);

function CurtainEdge() {
 return <svg className={styles.edge} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <path d="M59 0 41 100" fill="none" stroke="#b97c38" strokeWidth="28" opacity=".035" vectorEffect="non-scaling-stroke"/>
  <path d="M59 0 41 100" fill="none" stroke="#e6b16b" strokeWidth="12" opacity=".11" vectorEffect="non-scaling-stroke"/>
  <path d="M59 0 41 100" fill="none" stroke="#f6c78a" strokeWidth="4" opacity=".48" vectorEffect="non-scaling-stroke"/>
  <path d="M59 0 41 100" fill="none" stroke="#fff0d5" strokeWidth="1.1" opacity=".95" vectorEffect="non-scaling-stroke"/>
 </svg>;
}

export default function StageHero({onChooseArtist,onChooseVenue}:{onChooseArtist:()=>void;onChooseVenue:()=>void}) {
 const sectionRef=useRef<HTMLElement>(null);

 useEffect(()=>{
  const section=sectionRef.current;
  if(!section)return;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame=0;
  let inView=true;
  let disposed=false;
  let observer:IntersectionObserver|null=null;

  const writeMotion=(progress:number)=>{
   const motion=getStageMotion(progress);
   section.style.setProperty("--stage-open",motion.open.toFixed(4));
   section.style.setProperty("--stage-logo-opacity",motion.logoOpacity.toFixed(4));
   section.style.setProperty("--stage-copy-opacity",motion.copyOpacity.toFixed(4));
   section.style.setProperty("--stage-light-opacity",motion.lightOpacity.toFixed(4));
  };
  const cancelFrame=()=>{if(frame){window.cancelAnimationFrame(frame);frame=0;}};
  const pause=()=>{cancelFrame();section.setAttribute("data-motion","paused");};
  const showStatic=()=>{cancelFrame();writeMotion(0);section.setAttribute("data-motion","reduced");};
  const update=()=>{
   frame=0;
   if(disposed)return;
   if(reduced.matches){showStatic();return;}
   if(document.visibilityState==="hidden"||(observer&&!inView)){pause();return;}
   const rect=section.getBoundingClientRect();
   const viewportHeight=window.innerHeight||800;
   if(rect.top+rect.height<=0||rect.top>=viewportHeight){pause();return;}
   section.setAttribute("data-entered","true");
   section.setAttribute("data-motion","running");
   writeMotion(getStageProgress(rect.top,rect.height));
  };
  const schedule=()=>{
   if(disposed)return;
   if(reduced.matches){showStatic();return;}
   if(document.visibilityState==="hidden"||(observer&&!inView)){pause();return;}
   if(!frame)frame=window.requestAnimationFrame(update);
  };
  const onVisibility=()=>{if(document.visibilityState==="hidden")pause();else schedule();};
  const onPreference=()=>{cancelFrame();if(reduced.matches)showStatic();else schedule();};

  if(typeof IntersectionObserver!=="undefined"){
   observer=new IntersectionObserver(entries=>{
    if(disposed)return;
    const entry=entries.find(item=>item.target===section);
    if(!entry)return;
    inView=entry.isIntersecting;
    if(inView)schedule();else pause();
   },{threshold:0});
   observer.observe(section);
  }
  update();
  window.addEventListener("scroll",schedule,{passive:true});
  window.addEventListener("resize",schedule);
  document.addEventListener("visibilitychange",onVisibility);
  reduced.addEventListener("change",onPreference);
  return()=>{
   disposed=true;
   cancelFrame();
   observer?.disconnect();
   window.removeEventListener("scroll",schedule);
   window.removeEventListener("resize",schedule);
   document.removeEventListener("visibilitychange",onVisibility);
   reduced.removeEventListener("change",onPreference);
  };
 },[]);

 return <section ref={sectionRef} className={styles.hero} data-stage-hero="true" data-motion="paused" aria-label="Chọn show diễn theo ca sĩ hoặc địa điểm">
  <div className={styles.stage} aria-hidden="true">
   <div className={styles.backdrop}/>
   <div className={styles.floor}/>
   <div className={styles.floorLights}><i/><i/><i/><i/><i/></div>
  </div>
  <div className={styles.wingLeft} aria-hidden="true"><div className={styles.wingEnterLeft}><div className={styles.panelLeft}/><CurtainEdge/></div></div>
  <div className={styles.wingRight} aria-hidden="true"><div className={styles.wingEnterRight}><div className={styles.panelRight}/><CurtainEdge/></div></div>
  <div className={styles.atmosphere} aria-hidden="true">
   <div className={styles.spotlightLeft}/><div className={styles.spotlightRight}/>
   <div className={styles.haze}/>
   <div className={styles.dust}>{particles.map(index=><i key={index}/>)}</div>
  </div>
  <div className={styles.vignette} aria-hidden="true"/>
  <div className={styles.logoExit}>
   <div className={styles.logoReveal}>
    <span className={styles.logoHalo} aria-hidden="true"/>
    <picture className={styles.logoPicture}><source srcSet="/brand/extra-stage-logo.webp" type="image/webp"/><img src="/brand/extra-stage-logo.png" width="1536" height="1024" alt="+1 Extra Music Show" decoding="async" fetchPriority="high"/></picture>
    <p className={styles.brandLine}><span/>NHỮNG ĐÊM NHẠC ĐÁNG NHỚ<span/></p>
   </div>
  </div>
  <div className={styles.choices}>
   <a className={styles.artistChoice} href="#lich-show" aria-label="Xem tất cả show theo ca sĩ" onClick={event=>{event.preventDefault();onChooseArtist();}}>
    <span className={styles.artistCopyExit}><span className={styles.artistCopyReveal}>
     <small className={styles.eyebrow}>NGHỆ SĨ · ĐÊM NHẠC</small>
     <strong className={styles.choiceHeading}><span className={styles.titleLead}>CHỌN SHOW</span><span className={styles.titleMain}><span>THEO</span>{" "}<span>CA SĨ</span></span></strong>
     <span className={styles.choiceRule}/>
     <span className={styles.description}>Khám phá nghệ sĩ yêu thích<br/>và những đêm nhạc dành cho bạn.</span>
     <span className={styles.choiceAction}>Khám phá show <span aria-hidden="true">↗</span></span>
    </span></span>
   </a>
   <a className={styles.venueChoice} href="#dia-diem" aria-label="Khám phá show theo địa điểm" onClick={onChooseVenue}>
    <span className={styles.venueCopyExit}><span className={styles.venueCopyReveal}>
     <small className={styles.eyebrow}>SA PA · LÀO CAI</small>
     <strong className={styles.choiceHeading}><span className={styles.titleLead}>CHỌN SHOW</span><span className={styles.titleMain}><span>THEO</span>{" "}<span>ĐỊA ĐIỂM</span></span></strong>
     <span className={styles.choiceRule}/>
     <span className={styles.description}>Tìm một không gian yêu thích<br/>và tận hưởng đêm nhạc của bạn.</span>
     <span className={styles.choiceAction}>Xem địa điểm <span aria-hidden="true">↗</span></span>
    </span></span>
   </a>
  </div>
  <div className={styles.scrollCue} aria-hidden="true"><span className={styles.scrollLine}/><span>CUỘN ĐỂ MỞ SÂN KHẤU</span><svg viewBox="0 0 20 12" width="16" height="10" fill="none"><path d="m2 2 8 7 8-7" stroke="currentColor" strokeWidth="1.2"/></svg></div>
 </section>;
}
