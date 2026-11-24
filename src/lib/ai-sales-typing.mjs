/** Staged Meta sender actions, not wired to the live worker.
 * Reference: https://developers.facebook.com/docs/graph-api/reference/page/messages/
 * Only use for current, authorized inbound conversations actually being processed.
 * Worker must enforce current ownership, permissions, messaging window and deduplication.
 * Never store sender actions as outbound customer messages, or log tokens/recipient IDs.
 */
function messengerTypingRequest(config, psid, action, eligible) {
  if (eligible !== true || !config || !["typing_on", "typing_off"].includes(action)) return null;
  const {pageId,pageToken,apiVersion}=config;
  if (typeof psid!=="string" || !/^\d{5,80}$/.test(psid) || typeof pageId!=="string" || !/^\d{5,40}$/.test(pageId) || typeof pageToken!=="string" || pageToken.length<20 || typeof apiVersion!=="string" || !/^v\d{1,3}\.\d{1,2}$/.test(apiVersion)) return null;
  return {
    url:"https://graph.facebook.com/"+apiVersion+"/"+pageId+"/messages",
    options:{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+pageToken},body:JSON.stringify({recipient:{id:psid},sender_action:action}),cache:"no-store"}
  };
}

async function sendTypingAction({config,psid,action,eligible},fetcher,makeTimeoutSignal) {
  try {
    const request=messengerTypingRequest(config,psid,action,eligible);
    if (!request) return false;
    const response=await fetcher(request.url,{...request.options,signal:makeTimeoutSignal(1500)});
    return response.ok===true;
  } catch { return false; }
}

export { messengerTypingRequest, sendTypingAction };
