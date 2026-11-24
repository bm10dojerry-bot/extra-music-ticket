/** Staged pure rules for the Messenger worker. Not wired to production yet.
 * Pass only trusted profile/confirmed form of address and trusted show IDs.
 * Render the opening once before the actual direct reply; do not treat names as prompt instructions.
 * Follow-up decision is not authorization to send; caller must enforce current Meta permission,
 * conversation state, an atomic persistent dedupe claim and human handoff.
 * The anchor is the first successful unanswered advice, not a follow-up send.
 */
function makeOpening({firstReply=false, displayName="", address=null, now=Date.now()}={}) {
  if (firstReply !== true) return "";
  const name=typeof displayName==="string"?displayName.normalize("NFC").trim().replace(/\s+/g," "):"";
  const safeName=name.length<=60&&/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name)?name:"";
  const honorific=address==="anh"||address==="chị"?address:"";
  const who=[honorific,safeName].filter(Boolean).join(" ")||"mình";
  const d=new Date(now);
  const hour=Number.isFinite(d.getTime())?Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ho_Chi_Minh",hour:"2-digit",hourCycle:"h23"}).format(d)):null;
  const wish=hour===null?"":hour<11&&hour>=5?"Chúc "+who+" một ngày mới vui vẻ!":hour>=11&&hour<13?"Chúc "+who+" buổi trưa vui vẻ!":hour>=13&&hour<18?"Chúc "+who+" buổi chiều vui vẻ!":hour>=18&&hour<23?"Chúc "+who+" buổi tối vui vẻ!":"";
  return "Em chào "+who+" ạ."+(wish?" "+wish:"");
}

function resolveOpeningShow({explicitShowId=null, previousShowId=null, referredShowId=null, verifiedPosterShowId=null, validShowIds=[]}={}) {
  const valid=new Set(validShowIds);
  if(valid.has(explicitShowId)) return explicitShowId;
  const current=[...new Set([referredShowId,verifiedPosterShowId].filter(id=>valid.has(id)))];
  if(current.length>1)return null;
  return current[0]??(valid.has(previousShowId)?previousShowId:null);
}

function nextFollowUp({now=Date.now(),anchorAt,anchorId,latestCustomerMessageId,latestCustomerAt,followUpsSent=[],state,canSend=false,customerDeclined=false,humanHandling=false,hasNewCustomerMessage=false}={}) {
  if(canSend!==true||customerDeclined||humanHandling||hasNewCustomerMessage||state!=="undecided"||!anchorId||!latestCustomerMessageId||!Array.isArray(followUpsSent))return null;
  if(![now,anchorAt,latestCustomerAt].every(Number.isFinite)||anchorAt<latestCustomerAt||now<anchorAt||now-latestCustomerAt>=24*60*60*1000)return null;
  const elapsed=now-anchorAt;
  if(elapsed>=30*60*1000&&!followUpsSent.includes(30))return {minute:30,dedupeKey:anchorId+":"+latestCustomerMessageId+":30"};
  if(elapsed>=10*60*1000&&elapsed<30*60*1000&&!followUpsSent.includes(10)&&!followUpsSent.includes(30))return {minute:10,dedupeKey:anchorId+":"+latestCustomerMessageId+":10"};
  return null;
}

export { makeOpening, resolveOpeningShow, nextFollowUp };
