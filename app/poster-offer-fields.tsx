"use client";
import {useState} from "react";
import {hasPoster,offers,posterGifts,posterSelection,type Offer} from "../lib/poster-offers";

export function usePosterOffer(showId:string,seats:{id:string;zone:string}[]) {
  const [selection,setSelection]=useState<{id:string;offer:Offer}>({id:showId,offer:"none"});
  const offer=hasPoster(showId)&&selection.id===showId?selection.offer:"none";
  return {offer,count:seats.length,...posterSelection(offer,seats),setOffer:(value:Offer)=>setSelection({id:showId,offer:value})};
}
export function PosterOfferFields({value}:{value:ReturnType<typeof usePosterOffer>}) {
  return <div><label>Ưu đãi vé <select value={value.offer} onChange={e=>value.setOffer(e.target.value as Offer)}>
    {Object.entries(offers).map(([id,rule])=><option key={id} value={id}>{rule.label}</option>)}
  </select></label>{value.offer!=="none" && <p>Chọn {value.limit} ghế cho ưu đãi này.
    {value.gifts.length>0 && <> Ghế tặng (0đ) gồm {value.gifts.join(", ")}.</>}</p>}
    {value.count>value.limit&&<p role="alert">Bỏ bớt {value.count-value.limit} ghế để áp dụng lựa chọn này.</p>}
    <p>{posterGifts}</p></div>;
}
