"use client";
import {useEffect,useState} from "react";
import {hasPoster,posterChildren} from "../lib/poster-offers";
import {childFareNotice} from "../lib/show-family-policy";

export function useChildSeats(show:string, seats:string[]) {
  const [value,setValue] = useState<{show:string; seats:string[]}>({show,seats:[]});
  const children = value.show === show ? value.seats.filter(id => seats.includes(id)) : [];
  useEffect(() => {
    setValue(old => old.show !== show ? {show,seats:[]} : old.seats.some(id=>!seats.includes(id)) ? {show,seats:old.seats.filter(id=>seats.includes(id))} : old);
  },[show,seats]);
  function toggle(id:string) {
    setValue(old => {
      const current = old.show===show ? old.seats.filter(seat=>seats.includes(seat)) : [];
      return {show,seats:current.includes(id)?current.filter(seat=>seat!==id):[...current,id]};
    });
  }
  return {children,toggle};
}
export function ChildFareFields({seats,childrenIds,toggle,showId}:{showId:string;seats:string[];childrenIds:string[];toggle:(seat:string)=>void}) {
  return <details><summary>Vé trẻ em{childrenIds.length ? " · "+childrenIds.length+" ghế" : ""}</summary><p>{hasPoster(showId)?posterChildren:childFareNotice}</p>
    {seats.length>0 && <fieldset><legend>Chọn ghế riêng cho trẻ dưới {hasPoster(showId)?10:11} tuổi</legend>{seats.map(id=><label key={id} style={{display:"inline-flex",alignItems:"center",marginRight:12}}><input type="checkbox" style={{width:"auto"}} checked={childrenIds.includes(id)} onChange={()=>toggle(id)}/> Ghế {id}</label>)}</fieldset>}</details>;
}
