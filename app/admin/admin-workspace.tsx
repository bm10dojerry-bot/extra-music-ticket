"use client";

import {useEffect,useRef,useState,type ReactNode} from "react";
import type {Staff} from "../../lib/staff-auth";
import {adminGroups,adminSectionDetails,availableAdminSections,matchesAdminSection,type AdminIcon,type AdminNavItem,type AdminSection} from "./admin-navigation";
import styles from "./admin-workspace.module.css";

type IconName=AdminIcon|"menu"|"search"|"close";
const iconPaths:Record<IconName,ReactNode>={
  home:<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h5v-6h4v6h5V9"/></>,
  activity:<><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></>,
  music:<><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/></>,
  location:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  image:<><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 16-6-6L4 21"/></>,
  ticket:<><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5Z"/><path d="M15 5v3m0 3v2m0 3v3"/></>,
  users:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/></>,
  chat:<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/>,
  seats:<><rect x="5" y="3" width="14" height="10" rx="3"/><path d="M3 11v7h18v-7M6 18v3m12-3v3M3 14h18"/></>,
  checkin:<><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5m-8-9 3 3 6-6"/></>,
  chart:<><path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/></>,
  percent:<><path d="m5 19 14-14"/><circle cx="6.5" cy="6.5" r="3"/><circle cx="17.5" cy="17.5" r="3"/></>,
  wallet:<><path d="M21 8H5a2 2 0 0 1 0-4h14v4M3 6v13a2 2 0 0 0 2 2h16V8"/><path d="M21 12h-5v5h5"/></>,
  pie:<><path d="M11 3a9 9 0 1 0 10 10H11V3Z"/><path d="M15 3a8 8 0 0 1 6 6h-6V3Z"/></>,
  file:<><path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h8"/></>,
  briefcase:<><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a23 23 0 0 0 18 0m-9 0v4"/></>,
  phone:<path d="M7 3H3c0 10 8 18 18 18v-4l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>,
  menu:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  search:<><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,
};
function MenuIcon({name}:{name:IconName}) {
 return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

function NavigationList({items,section,onSelect,prefix,extraOs}:{items:readonly AdminNavItem[];section:AdminSection;onSelect:(id:AdminSection)=>void;prefix:string;extraOs:boolean}) {
 return <>{adminGroups.map(group=>{
  const entries=items.filter(item=>item.group===group);
  return entries.length||group==="Điều hành"&&extraOs?<div className={styles.navGroup} key={group}>
   <p className={styles.menuLabel}>{group}</p>
   {group==="Điều hành"&&extraOs&&<a href="/admin/ai-marketing" className={styles.navButton}><MenuIcon name="activity"/><span>EXTRA OS</span><span className={styles.navArrow} aria-hidden="true">›</span></a>}
   {entries.map(item=><button key={item.id} id={prefix+item.id} type="button" className={section===item.id?styles.navActive:styles.navButton} aria-current={section===item.id?"page":undefined} aria-controls="admin-panel" onClick={()=>onSelect(item.id)}>
    <MenuIcon name={item.icon}/><span>{item.label}</span><span className={styles.navArrow} aria-hidden="true">›</span>
   </button>)}
  </div>:null;
 })}</>;
}

export default function AdminWorkspace({actor,section,onNavigate,children}:{actor:Staff;section:AdminSection;onNavigate:(section:AdminSection)=>void;children:ReactNode}) {
 const [search,setSearch]=useState("");
 const [menuSearch,setMenuSearch]=useState("");
 const [menuOpen,setMenuOpen]=useState(false);
 const dialog=useRef<HTMLDialogElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 const heading=useRef<HTMLHeadingElement>(null);
 const firstSection=useRef(true);
 const moreButton=useRef<HTMLButtonElement>(null);
 const items=availableAdminSections(actor.role);
 const current=adminSectionDetails(section);
 const visibleItems=items.filter(item=>matchesAdminSection(item,search));
 const menuItems=items.filter(item=>matchesAdminSection(item,menuSearch));
 const primary:ReadonlyArray<{id:AdminSection;label:string}>=[
  {id:"overview",label:"Home"},{id:"tickets",label:"Vé"},
  actor.role==="admin"?{id:"sale-performance",label:"Sale"}:{id:"shows",label:"Show"},
  {id:"support-chats",label:"Chat"},
 ];
 const extraActive=!primary.some(item=>item.id===section);
 const displayName=actor.display_name||actor.username;
 const initials=displayName.trim().split(/\s+/).slice(-2).map(word=>word[0]).join("").toLocaleUpperCase("vi");
 const roleLabel=actor.role==="admin"?"Quản trị hệ thống":"Quản lý show";
 const logoutAction=actor.id==="owner"?"/api/admin/logout":"/api/staff/logout";

 useEffect(()=>{
  if(firstSection.current){firstSection.current=false;return;}
  const frame=window.requestAnimationFrame(()=>{
   heading.current?.focus({preventScroll:true});
   window.scrollTo({top:0,behavior:"auto"});
  });
  return ()=>window.cancelAnimationFrame(frame);
 },[section]);

 useEffect(()=>{
  if(!menuOpen)return;
  const element=dialog.current;
  if(!element)return;
  if(!element.open)element.showModal();
  closeButton.current?.focus();
  const previousOverflow=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const desktop=window.matchMedia("(min-width: 901px)");
  const onResize=()=>{if(desktop.matches)setMenuOpen(false);};
  desktop.addEventListener("change",onResize);
  return ()=>{
   document.body.style.overflow=previousOverflow;
   desktop.removeEventListener("change",onResize);
   if(element.open)element.close();
  };
 },[menuOpen]);

 function select(id:AdminSection) {
  setMenuOpen(false);
  setMenuSearch("");
  setSearch("");
  onNavigate(id);
 }
 function closeMenu() {
  setMenuOpen(false);
  moreButton.current?.focus();
 }

 return <div className={styles.shell}>
  <a className={styles.skipLink} href="#admin-main">Đến nội dung quản trị</a>
  <div className={styles.workspace}>
   <aside className={styles.sidebar} aria-label="Điều hướng quản trị">
    <a href="https://iextra.net/" className={styles.brand}><span className={styles.brandMark}>+1</span><span><strong>EXTRA</strong><small>ADMIN WORKSPACE</small></span></a>
    <label className={styles.search}><MenuIcon name="search"/><span className={styles.srOnly}>Tìm mục quản trị</span><input type="search" placeholder="Tìm mục quản trị…" value={search} onChange={event=>setSearch(event.target.value)}/></label>
    <nav className={styles.navigation} aria-label="Menu Admin">
     <NavigationList items={visibleItems} section={section} onSelect={select} prefix="admin-nav-" extraOs={actor.role==="admin"&&"extra os".includes(search.trim().toLowerCase())}/>
     {!visibleItems.length?<p className={styles.noResults} role="status">Không tìm thấy mục phù hợp.</p>:null}
    </nav>
    <div className={styles.sidebarBottom}>
     <div className={styles.account}><span className={styles.avatar}>{initials}</span><div><strong>{displayName}</strong><small>{roleLabel}</small></div></div>
     <div className={styles.utilities}><a href="https://iextra.net/" target="_blank" rel="noopener noreferrer">Xem website <span aria-hidden="true">↗</span></a><a href="/reset-password?from=admin">Đổi mật khẩu</a></div>
     <form action={logoutAction} method="post"><button type="submit" className={styles.logout}>Đăng xuất</button></form>
    </div>
   </aside>
   <main id="admin-main" className={styles.main} tabIndex={-1}>
    <div className={styles.mobileAccount}>
     <div><span>+1 EXTRA · ADMIN</span><strong>{displayName}</strong></div>
     <div className={styles.mobileUtilities}><a href="/reset-password?from=admin">Đổi mật khẩu</a><form action={logoutAction} method="post"><button type="submit">Đăng xuất</button></form></div>
    </div>
    <header className={section==="overview"?styles.overviewHeader:styles.pageHeader}>
     <div><p className={styles.eyebrow}>ADMIN / {current.group.toLocaleUpperCase("vi")}</p><h1 id="admin-workspace-title" tabIndex={-1} ref={heading}>{current.title}</h1><p className={styles.description}>{current.description}</p></div>
    </header>
    <div id="admin-panel" className={styles.view} aria-labelledby="admin-workspace-title">{children}</div>
   </main>
  </div>
  <nav className={styles.mobileNavigation} aria-label="Truy cập nhanh Admin">
   {primary.map(item=><button key={item.id} type="button" id={"admin-mobile-"+item.id} className={section===item.id?styles.mobileActive:styles.mobileButton} aria-current={section===item.id?"page":undefined} aria-controls="admin-panel" onClick={()=>select(item.id)}><MenuIcon name={adminSectionDetails(item.id).icon}/><span>{item.label}</span></button>)}
   <button type="button" id="admin-mobile-more" ref={moreButton} className={extraActive||menuOpen?styles.mobileActive:styles.mobileButton} aria-label="Thêm chức năng quản trị" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="admin-menu-dialog" onClick={()=>{setMenuSearch("");setMenuOpen(true);}}><MenuIcon name="menu"/><span>Thêm</span>{extraActive?<i className={styles.activeDot} aria-hidden="true"/>:null}</button>
  </nav>
  <dialog ref={dialog} id="admin-menu-dialog" className={styles.menuDialog} aria-labelledby="admin-menu-title" onCancel={event=>{event.preventDefault();closeMenu();}} onClose={()=>{if(!dialog.current?.open)setMenuOpen(false);}} onClick={event=>{if(event.target===event.currentTarget)closeMenu();}}>
   <div className={styles.menuSheet}>
    <header className={styles.menuHeading}><div><p>+1 EXTRA · ADMIN</p><h2 id="admin-menu-title">Tất cả chức năng</h2></div><button type="button" ref={closeButton} className={styles.closeButton} aria-label="Đóng menu quản trị" onClick={closeMenu}><MenuIcon name="close"/></button></header>
    <label className={styles.search}><MenuIcon name="search"/><span className={styles.srOnly}>Tìm chức năng quản trị</span><input type="search" placeholder="Tìm show, khách hàng, hoa hồng…" value={menuSearch} onChange={event=>setMenuSearch(event.target.value)}/></label>
    <nav className={styles.menuList} aria-label="Tất cả mục Admin">
     <NavigationList items={menuItems} section={section} onSelect={select} prefix="admin-menu-" extraOs={actor.role==="admin"&&"extra os".includes(menuSearch.trim().toLowerCase())}/>
     {!menuItems.length?<p className={styles.noResults} role="status">Không tìm thấy mục phù hợp. Thử từ khóa khác để tìm lại.</p>:null}
    </nav>
    <a href="https://iextra.net/" target="_blank" rel="noopener noreferrer" className={styles.websiteLink}>Xem website Extra <span aria-hidden="true">↗</span></a>
   </div>
  </dialog>
 </div>;
}
