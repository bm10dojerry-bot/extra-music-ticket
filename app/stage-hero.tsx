"use client";

import {useEffect,useRef,type MouseEvent} from "react";
import {getStageMotion,getStageProgress,STAGE_OPEN_DURATION_MS} from "./stage-hero-motion";
import styles from "./stage-hero.module.css";

const particles=Array.from({length:8},(_,index)=>index);
type StageNavigation="idle"|"opening"|"opened";

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
 const startOpeningRef=useRef<((callback:()=>void)=>void)|null>(null);

 useEffect(()=>{
  const section=sectionRef.current;
  if(!section)return;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame=0;
  let inView=true;
  let disposed=false;
  let observer:IntersectionObserver|null=null;
  let navigation:StageNavigation="idle";
  let navigationTimer=0;
  let pendingChoice:(()=>void)|null=null;
  let outsideViewport=false;

  const writeMotion=(progress:number)=>{
   const motion=getStageMotion(progress);
   section.style.setProperty("--stage-open",motion.open.toFixed(4));
   section.style.setProperty("--stage-copy-opacity",motion.copyOpacity.toFixed(4));
   section.style.setProperty("--stage-light-opacity",motion.lightOpacity.toFixed(4));
  };
  const cancelFrame=()=>{if(frame){window.cancelAnimationFrame(frame);frame=0;}};
  const cancelNavigationTimer=()=>{if(navigationTimer){window.clearTimeout(navigationTimer);navigationTimer=0;}};
  const setNavigation=(next:StageNavigation)=>{navigation=next;section.setAttribute("data-navigation",next);};
  const pause=()=>{cancelFrame();section.setAttribute("data-motion","paused");};
  const showStatic=()=>{cancelFrame();writeMotion(0);section.setAttribute("data-motion","reduced");};
  const markOutside=()=>{
   outsideViewport=true;
   if(navigation==="opened")setNavigation("idle");
   pause();
  };
  const completeNavigation=()=>{
   cancelNavigationTimer();
   if(disposed||navigation!=="opening")return;
   setNavigation("opened");
   writeMotion(reduced.matches?0:1);
   const callback=pendingChoice;
   pendingChoice=null;
   callback?.();
   // Keep the open frame through the parent's focus/scroll commit. Reset only
   // after departure, so returning to the hero can follow scroll normally.
   if(!disposed&&outsideViewport)setNavigation("idle");
  };
  const beginNavigation=(callback:()=>void)=>{
   if(disposed||navigation!=="idle")return;
   cancelFrame();
   pendingChoice=callback;
   setNavigation("opening");
   if(reduced.matches){showStatic();completeNavigation();return;}
   writeMotion(1);
   navigationTimer=window.setTimeout(completeNavigation,STAGE_OPEN_DURATION_MS);
  };
  const update=()=>{
   frame=0;
   if(disposed)return;
   if(reduced.matches){showStatic();return;}
   if(document.visibilityState==="hidden"||(observer&&!inView)){pause();return;}
   const rect=section.getBoundingClientRect();
   const viewportHeight=window.innerHeight||800;
   if(rect.top+rect.height<=0||rect.top>=viewportHeight){markOutside();return;}
   outsideViewport=false;
   section.setAttribute("data-entered","true");
   section.setAttribute("data-motion","running");
   if(navigation!=="opening")writeMotion(navigation==="opened"?1:getStageProgress(rect.top,rect.height));
  };
  const schedule=()=>{
   if(disposed)return;
   if(reduced.matches){
    if(!observer&&navigation==="opened"){
     const rect=section.getBoundingClientRect();
     if(rect.top+rect.height<=0||rect.top>=(window.innerHeight||800))markOutside();
    }
    showStatic();return;
   }
   if(document.visibilityState==="hidden"||(observer&&!inView)){pause();return;}
   if(!frame)frame=window.requestAnimationFrame(update);
  };
  const onVisibility=()=>{if(document.visibilityState==="hidden")pause();else schedule();};
  const onPreference=()=>{
   cancelFrame();
   if(reduced.matches){showStatic();if(navigation==="opening")completeNavigation();}
   else schedule();
  };

  if(typeof IntersectionObserver!=="undefined"){
   observer=new IntersectionObserver(entries=>{
    if(disposed)return;
    const entry=entries.find(item=>item.target===section);
    if(!entry)return;
    inView=entry.isIntersecting;
    if(inView){outsideViewport=false;schedule();}else markOutside();
   },{threshold:0});
   observer.observe(section);
  }
  section.style.setProperty("--stage-open-duration",`${STAGE_OPEN_DURATION_MS}ms`);
  startOpeningRef.current=beginNavigation;
  update();
  window.addEventListener("scroll",schedule,{passive:true});
  window.addEventListener("resize",schedule);
  document.addEventListener("visibilitychange",onVisibility);
  reduced.addEventListener("change",onPreference);
  return()=>{
   disposed=true;
   cancelFrame();
   cancelNavigationTimer();
   pendingChoice=null;
   startOpeningRef.current=null;
   observer?.disconnect();
   window.removeEventListener("scroll",schedule);
   window.removeEventListener("resize",schedule);
   document.removeEventListener("visibilitychange",onVisibility);
   reduced.removeEventListener("change",onPreference);
  };
 },[]);

 const choose=(event:MouseEvent<HTMLAnchorElement>,callback:()=>void)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(startOpeningRef.current)startOpeningRef.current(callback);
  else callback();
 };

 return <section ref={sectionRef} className={styles.hero} data-stage-hero="true" data-motion="paused" data-navigation="idle" aria-label="Chọn show diễn theo ca sĩ hoặc địa điểm">
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
  <div className={styles.choices}>
   <a className={styles.artistChoice} href="#lich-show" aria-label="Xem tất cả show theo ca sĩ" onClick={event=>choose(event,onChooseArtist)}>
    <span className={styles.artistCopyExit}><span className={styles.artistCopyReveal}>
     <small className={styles.eyebrow}>NGHỆ SĨ · ĐÊM NHẠC</small>
     <strong className={styles.choiceHeading}><span className={styles.titleLead}>CHỌN SHOW</span><span className={styles.titleMain}><span>THEO</span>{" "}<span>CA SĨ</span></span></strong>
     <span className={styles.choiceRule}/>
     <span className={styles.description}>Khám phá nghệ sĩ yêu thích<br/>và những đêm nhạc dành cho bạn.</span>
     <span className={styles.choiceAction}>Khám phá show <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M7 7h10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    </span></span>
   </a>
   <a className={styles.venueChoice} href="#dia-diem" aria-label="Khám phá show theo địa điểm" onClick={event=>choose(event,onChooseVenue)}>
    <span className={styles.venueCopyExit}><span className={styles.venueCopyReveal}>
     <small className={styles.eyebrow}>SA PA · LÀO CAI</small>
     <strong className={styles.choiceHeading}><span className={styles.titleLead}>CHỌN SHOW</span><span className={styles.titleMain}><span>THEO</span>{" "}<span>ĐỊA ĐIỂM</span></span></strong>
     <span className={styles.choiceRule}/>
     <span className={styles.description}>Tìm một không gian yêu thích<br/>và tận hưởng đêm nhạc của bạn.</span>
     <span className={styles.choiceAction}>Xem địa điểm <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M7 17 17 7M7 7h10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
    </span></span>
   </a>
  </div>
 </section>;
}
