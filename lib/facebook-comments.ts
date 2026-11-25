import "server-only";
import {getMessengerConfig,getMessengerGraphConfig,MessengerSendError} from "./facebook-messenger";

const PAGE_ID="1223940670813189";
const APP_ID="2447629075989535";
const CALLBACK_URL="https://iextra.net/api/meta/messenger/webhook";
const MAX_AGE_MS=7*86_400_000;
const POST_FIELDS="id,from{id},message,permalink_url,is_hidden";
const COMMENT_FIELDS="id,from{id,name},message,created_time,is_hidden,is_private,can_reply_privately,object{id},parent{id}";
const REQUIRED_SCOPES=["pages_messaging","pages_read_engagement","pages_read_user_content","pages_manage_metadata","pages_show_list"];
type Config=NonNullable<ReturnType<typeof getMessengerConfig>>;
type Json=Record<string,unknown>;
export type CommentSource={
 pageId:string;postId:string;commentId:string;authorId:string;authorName:string;
 body:string;postText:string;postUrl:string;createdAt:string;hidden:boolean;
 canReplyPrivately:boolean;verifiedAt:string;
};
type ReadErrorCode="not_configured"|"invalid_source"|"source_unavailable"|"permission_denied"|"rate_limited"|"network_error"|"invalid_response";
const READ_MESSAGES:Record<ReadErrorCode,string>={
 not_configured:"Chưa cấu hình kết nối bình luận của Page EXTRA.",
 invalid_source:"Chưa xác minh được bình luận thuộc bài viết của Page EXTRA.",
 source_unavailable:"Không còn đọc được bài viết hoặc bình luận trên Facebook.",
 permission_denied:"Kết nối Facebook chưa đủ quyền đọc bình luận của Page.",
 rate_limited:"Facebook đang giới hạn lượt đọc bình luận; cần thử lại sau.",
 network_error:"Chưa kết nối được Facebook để kiểm tra bình luận.",
 invalid_response:"Facebook chưa trả về đủ dữ liệu để xác minh bình luận."
};
export class FacebookCommentReadError extends Error{
 constructor(public readonly code:ReadErrorCode,public readonly statusCode?:number,public readonly providerCode?:number){super(READ_MESSAGES[code]);this.name="FacebookCommentReadError";}
}
const object=(value:unknown):Json|null=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Json:null;
const numeric=(value:unknown):value is string=>typeof value==="string"&&/^[0-9]{5,80}$/.test(value);
const commentIdValid=(value:unknown):value is string=>typeof value==="string"&&/^[0-9]{5,80}(_[0-9]{5,80}){0,2}$/.test(value);
const postIdValid=(value:unknown):value is string=>typeof value==="string"&&new RegExp("^"+PAGE_ID+"_[0-9]{5,80}$").test(value);
const configOrThrow=async():Promise<Config>=>{const config=await getMessengerGraphConfig();if(!config||config.pageId!==PAGE_ID)throw new FacebookCommentReadError("not_configured");return config;};
const nodeId=(value:unknown)=>{const row=object(value);return row&&typeof row.id==="string"?row.id:"";};
const postMatches=(objectId:string,postId:string)=>objectId===postId||objectId===postId.slice(PAGE_ID.length+1);
const canonicalPostId=(value:unknown)=>postIdValid(value)?value:numeric(value)?PAGE_ID+"_"+value:"";
function classifyReadError(status:number,data:Json|null):FacebookCommentReadError{
 const error=object(data?.error),code=typeof error?.code==="number"&&Number.isFinite(error.code)?error.code:undefined;
 if(status===401||status===403||[10,190,200,283,459].includes(code||0))return new FacebookCommentReadError("permission_denied",status,code);
 if(status===429||[4,17,32,613,80001].includes(code||0))return new FacebookCommentReadError("rate_limited",status,code);
 return new FacebookCommentReadError(status===404||[100,803,210].includes(code||0)?"source_unavailable":"invalid_response",status,code);
}
async function graphGet(config:Config,path:string,params:Record<string,string>={},auth=config.pageToken,timeoutMs=8500):Promise<Json>{
 // Only constant endpoints or validated node IDs are admitted by callers. Never
 // follow paging.next: it can contain a token and is not a trusted destination.
 if(!/^(me|debug_token|[0-9_]+(?:\/(?:published_posts|comments|subscribed_apps|subscriptions))?)$/.test(path))throw new FacebookCommentReadError("invalid_source");
 const url=new URL("https://graph.facebook.com/"+config.apiVersion+"/"+path);
 for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
 let response:Response;
 try{response=await fetch(url.toString(),{headers:{Authorization:"Bearer "+auth},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(Math.max(1,Math.floor(timeoutMs)))});}
 catch{throw new FacebookCommentReadError("network_error");}
 const data=object(await response.json().catch(()=>null));
 if(!response.ok||data?.error)throw classifyReadError(response.status,data);
 if(!data)throw new FacebookCommentReadError("invalid_response",response.status);
 return data;
}
function verifiedPost(value:Json,expectedId?:string):Json{
 const id=canonicalPostId(value.id);
 if(!id||nodeId(value.from)!==PAGE_ID||(expectedId&&id!==expectedId))throw new FacebookCommentReadError("invalid_source");
 return {...value,id};
}
function safePostUrl(value:unknown):string{
 if(typeof value!=="string")return "";
 try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password&&["facebook.com","www.facebook.com","m.facebook.com"].includes(url.hostname)?url.href:"";}catch{return "";}
}
function createdTime(value:unknown):number{
 if(typeof value==="number"&&Number.isFinite(value)&&value>0)return value*1000;
 return typeof value==="string"?Date.parse(value):NaN;
}
function toSource(post:Json,comment:Json,expectedCommentId?:string):CommentSource{
 const postId=String(post.id),author=object(comment.from),authorId=author?.id;
 if(!postIdValid(postId)||!commentIdValid(comment.id)||(expectedCommentId&&comment.id!==expectedCommentId)||!numeric(authorId)||authorId===PAGE_ID)throw new FacebookCommentReadError("invalid_source");
 const body=typeof comment.message==="string"?comment.message.trim():"";
 const createdAt=createdTime(comment.created_time);
 if(!body||body.length>5000||!Number.isFinite(createdAt)||typeof comment.is_hidden!=="boolean"||typeof comment.can_reply_privately!=="boolean")throw new FacebookCommentReadError("invalid_response");
 return {pageId:PAGE_ID,postId,commentId:comment.id,authorId,authorName:typeof author?.name==="string"?author.name.trim().slice(0,120):"",
  body,postText:typeof post.message==="string"?post.message.slice(0,5000):"",postUrl:safePostUrl(post.permalink_url),createdAt:new Date(createdAt).toISOString(),
  hidden:comment.is_hidden||comment.is_private===true||post.is_hidden===true,canReplyPrivately:comment.can_reply_privately,verifiedAt:new Date().toISOString()};
}
async function verifyCommentParent(config:Config,comment:Json,postId:string):Promise<void>{
 let node=comment;const visited=new Set<string>();
 for(let depth=0;depth<4;depth++){
  const objectId=nodeId(node.object);
  if(objectId&&postMatches(objectId,postId))return;
  const parentId=nodeId(node.parent);
  if(objectId&&objectId!==parentId)break;
  if(!commentIdValid(parentId)||visited.has(parentId))break;
  visited.add(parentId);
  node=await graphGet(config,parentId,{fields:"id,object{id},parent{id}"});
  if(node.id!==parentId)break;
 }
 throw new FacebookCommentReadError("invalid_source");
}

/** Fresh source verification; public comment author IDs are never Messenger PSIDs. */
export async function fetchVerifiedCommentSource(postId:string,commentId:string):Promise<CommentSource>{
 const config=await configOrThrow();
 if(!postIdValid(postId)||!commentIdValid(commentId))throw new FacebookCommentReadError("invalid_source");
 const [rawPost,comment]=await Promise.all([graphGet(config,postId,{fields:POST_FIELDS}),graphGet(config,commentId,{fields:COMMENT_FIELDS})]);
 const post=verifiedPost(rawPost,postId);
 const source=toSource(post,comment,commentId);
 await verifyCommentParent(config,comment,postId);
 return {...source,verifiedAt:new Date().toISOString()};
}

/** Caller must persist its one-shot send intent and check live eligibility first. */
export async function sendCommentPrivateReply(commentId:string,body:string):Promise<{messageId:string;recipientPsid:string|null}>{
 let config:Config;try{config=await configOrThrow();}catch{throw new MessengerSendError(false);}
 if(!commentIdValid(commentId)||typeof body!=="string"||!body.trim()||body.length>1000)throw new MessengerSendError(false);
 let response:Response;
 try{response=await fetch("https://graph.facebook.com/"+config.apiVersion+"/"+config.pageId+"/messages",{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+config.pageToken},
  body:JSON.stringify({recipient:{comment_id:commentId},message:{text:body}}),cache:"no-store",redirect:"error",signal:AbortSignal.timeout(9500)
 });}catch{throw new MessengerSendError(true);}
 const data=object(await response.json().catch(()=>null)),error=object(data?.error);
 const providerCode=typeof error?.code==="number"&&Number.isFinite(error.code)?error.code:undefined;
 if(!response.ok){const definite=providerCode!==undefined||(response.status>=400&&response.status<500&&response.status!==408);throw new MessengerSendError(!definite,response.status,providerCode);}
 const mid=data?.message_id,recipient=data?.recipient_id;
 if(data?.error||typeof mid!=="string"||!mid||mid!==mid.trim()||mid.length>200||/[\u0000-\u001f\u007f]/.test(mid)||(recipient!==undefined&&recipient!==null&&!numeric(recipient)))throw new MessengerSendError(true,response.status,providerCode);
 return {messageId:mid,recipientPsid:numeric(recipient)?recipient:null};
}

/** Token permission checks do not establish App Review / Advanced Access approval. */
export async function probeCommentPageAccess():Promise<{pageAccessReady:boolean;feedSubscribed:boolean;appFeedSubscribed:boolean;permissionsReady:boolean;message:string|null}>{
 let config:Config;try{config=await configOrThrow();}catch{return {pageAccessReady:false,feedSubscribed:false,appFeedSubscribed:false,permissionsReady:false,message:READ_MESSAGES.not_configured};}
 const results=await Promise.allSettled([
  graphGet(config,"me",{fields:"id"}),
  graphGet(config,config.pageId+"/published_posts",{fields:"id,from{id},comments.limit(1){id,can_reply_privately}",limit:"1"}),
  graphGet(config,config.pageId+"/subscribed_apps",{fields:"id,subscribed_fields"}),
  graphGet(config,"debug_token",{input_token:config.pageToken},APP_ID+"|"+config.appSecret),
  graphGet(config,APP_ID+"/subscriptions",{},APP_ID+"|"+config.appSecret)
 ]);
 const value=(index:number):Json|null=>results[index].status==="fulfilled"?(results[index] as PromiseFulfilledResult<Json>).value:null;
 const identity=value(0),posts=value(1),subscriptions=value(2),token=object(value(3)?.data);
 const pageAccessReady=identity?.id===PAGE_ID&&Array.isArray(posts?.data)&&posts.data.every(post=>{const item=object(post);return item&&nodeId(item.from)===PAGE_ID&&postIdValid(canonicalPostId(item.id))&&Array.isArray(object(item.comments)?.data);});
 const ownApp=Array.isArray(subscriptions?.data)?subscriptions.data.map(object).find(app=>app?.id===APP_ID):null;
 const pageFeedSubscribed=Array.isArray(ownApp?.subscribed_fields)&&ownApp.subscribed_fields.includes("feed");
 // A rejected/partial read cannot prove that the subscription is absent.
 // This only refines the diagnostic; unverified feed access still blocks sends.
 const pageSubscriptionReadConclusive=Array.isArray(subscriptions?.data)&&(ownApp
  ?Array.isArray(ownApp.subscribed_fields)&&ownApp.subscribed_fields.every(field=>typeof field==="string")
  :subscriptions.data.every(app=>numeric(object(app)?.id))&&!object(subscriptions.paging)?.next);
 const appSubscriptions=value(4);
 const appFeedSubscribed=Array.isArray(appSubscriptions?.data)&&appSubscriptions.data.some(value=>{
  const subscription=object(value);
  return subscription?.object==="page"&&subscription.active===true&&subscription.callback_url===CALLBACK_URL&&Array.isArray(subscription.fields)&&subscription.fields.some(field=>field==="feed"||object(field)?.name==="feed");
 });
 const feedSubscribed=pageFeedSubscribed&&appFeedSubscribed;
 const now=Math.floor(Date.now()/1000),scopes=Array.isArray(token?.scopes)?token.scopes:[],granular=Array.isArray(token?.granular_scopes)?token.granular_scopes.map(object):[];
 const expiryValid=(value:unknown)=>value===undefined||(typeof value==="number"&&Number.isFinite(value)&&(value===0||value>now));
 const tokenVerified=token?.is_valid===true&&token.app_id===APP_ID&&(token.profile_id===undefined||token.profile_id===PAGE_ID)&&expiryValid(token.expires_at)&&expiryValid(token.data_access_expires_at);
 const missingScopes=REQUIRED_SCOPES.filter(scope=>{
  if(!scopes.includes(scope))return true;
  const grants=granular.filter(grant=>grant?.scope===scope);
  return !grants.every(grant=>grant?.target_ids===undefined||(Array.isArray(grant.target_ids)&&grant.target_ids.some(id=>String(id)===PAGE_ID)));
 });
 // Include missing permission names, but never infer missing grants from a
 // failed token-debug request or expose its token metadata to the browser.
 const permissionsReady=tokenVerified&&missingScopes.length===0;
 const issues:string[]=[];
 if(!pageAccessReady)issues.push("Chưa xác minh được quyền đọc bài viết và bình luận của Page EXTRA.");
 if(!permissionsReady)issues.push(tokenVerified?"Thiếu quyền cho Page EXTRA: "+missingScopes.join(", ")+".":"Chưa xác minh được token của ứng dụng Extra và các quyền đọc bình luận, quản lý webhook, nhắn tin.");
 if(!pageFeedSubscribed)issues.push(pageSubscriptionReadConclusive?"Ứng dụng Extra chưa được đăng ký nhận bình luận (feed) trên Page.":"Chưa xác minh được đăng ký nhận bình luận (feed) của ứng dụng Extra trên Page.");
 if(!appFeedSubscribed)issues.push("Chưa xác minh đăng ký feed đang hoạt động tại ứng dụng Meta với đúng webhook EXTRA.");
 if(results.some(result=>result.status==="rejected"&&result.reason instanceof FacebookCommentReadError&&result.reason.code==="network_error"))issues.push(READ_MESSAGES.network_error);
 return {pageAccessReady:Boolean(pageAccessReady),feedSubscribed:Boolean(feedSubscribed),appFeedSubscribed:Boolean(appFeedSubscribed),permissionsReady:Boolean(permissionsReady),message:issues.join(" ")||null};
}

function pagination(data:Json):{more:boolean;after:string|null}{
 const paging=object(data.paging),cursors=object(paging?.cursors),raw=cursors?.after;
 return {more:typeof paging?.next==="string"&&paging.next.length>0,after:typeof raw==="string"&&raw.length>0&&raw.length<=2000&&!/[\u0000-\u001f\u007f]/.test(raw)?raw:null};
}
/** Bounded catch-up: 25 latest published posts, at most 100 returned comments.
 * Older posts can have new comments, so apply the seven-day cutoff to comments.
 * Unpublished ad-post comments are received through the signed feed webhook. */
export async function readRecentPageComments():Promise<{events:CommentSource[];limited:boolean}>{
 const config=await configOrThrow(),posts:Json[]=[],events:CommentSource[]=[];
 const deadline=Date.now()+55_000;
 const boundedGet=async(path:string,params:Record<string,string>):Promise<Json|null>=>{
  const remaining=deadline-Date.now();if(remaining<=0)return null;
  try{return await graphGet(config,path,params,config.pageToken,Math.min(8500,remaining));}
  catch(error){if(Date.now()>=deadline)return null;throw error;}
 };
 const seenPosts=new Set<string>(),seenComments=new Set<string>(),postCursors=new Set<string>();
 let limited=false,after:string|null=null;
 for(let batch=0;batch<5&&posts.length<25;batch++){
  const data=await boundedGet(config.pageId+"/published_posts",{fields:POST_FIELDS,limit:String(25-posts.length),...(after?{after}:{})});
  if(!data){limited=true;break;}
  if(!Array.isArray(data.data))throw new FacebookCommentReadError("invalid_response");
  if(data.data.length>25-posts.length)limited=true;
  for(const value of data.data.slice(0,25-posts.length)){
   const raw=object(value);if(!raw){limited=true;continue;}
   let post:Json;try{post=verifiedPost(raw);}catch{limited=true;continue;}
   const id=String(post.id);if(seenPosts.has(id)){limited=true;continue;}seenPosts.add(id);posts.push(post);
  }
  const next=pagination(data);
  if(!next.more)break;
  if(posts.length>=25||!next.after||postCursors.has(next.after)||batch===4){limited=true;break;}
  postCursors.add(next.after);after=next.after;
 }
 const now=Date.now(),cutoff=now-MAX_AGE_MS+60_000;let scanned=0;
 for(let postIndex=0;postIndex<posts.length;postIndex++){
  if(scanned>=100||Date.now()>=deadline){limited=true;break;}
  const post=posts[postIndex];if(post.is_hidden===true)continue;
  const cursors=new Set<string>();let commentAfter:string|null=null;
  for(let batch=0;batch<4&&scanned<100;batch++){
   const limit=Math.min(25,100-scanned),data=await boundedGet(String(post.id)+"/comments",{fields:COMMENT_FIELDS,filter:"stream",order:"reverse_chronological",since:String(Math.floor(cutoff/1000)),limit:String(limit),...(commentAfter?{after:commentAfter}:{})});
   if(!data){limited=true;break;}
   if(!Array.isArray(data.data))throw new FacebookCommentReadError("invalid_response");
   if(data.data.length>limit)limited=true;
   for(const value of data.data.slice(0,limit)){
    scanned++;const comment=object(value);if(!comment){limited=true;continue;}
    // Membership in this exact owned-post edge proves the relationship. Do not
    // infer identities from a comment ID or from an unrelated profile lookup.
    if(nodeId(comment.from)===PAGE_ID)continue;
    let source:CommentSource;try{source=toSource(post,comment);}catch{limited=true;continue;}
    const created=Date.parse(source.createdAt);
    if(source.hidden||created<=cutoff||created>now+60_000||!source.canReplyPrivately||seenComments.has(source.commentId))continue;
    seenComments.add(source.commentId);events.push(source);
   }
   const next=pagination(data);
   if(!next.more)break;
   if(scanned>=100||!next.after||cursors.has(next.after)||batch===3){limited=true;break;}
   cursors.add(next.after);commentAfter=next.after;
  }
 }
 return {events,limited};
}
