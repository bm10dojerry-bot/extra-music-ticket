/**
 * AI-first Messenger conversation ownership.
 * Pure deterministic transition helpers; persistence and delivery must be
 * implemented atomically by the integration layer before production use.
 */
export const HUMAN_IDLE_MS = 180_000;
export type Owner = "ai" | "human";
export type Ownership = {
  owner: Owner;
  lastHumanActivityAt: string | null;
  humanRequested: boolean;
};
export function humanIntervened(state:Ownership, at:string):Ownership {
  if(!Number.isFinite(Date.parse(at)))throw new Error("Invalid human activity timestamp");
  return {...state,owner:"human",lastHumanActivityAt:at};
}
export function requestHuman(state:Ownership):Ownership {
  return {...state,owner:"human",humanRequested:true};
}
export function clearHumanRequest(state:Ownership):Ownership {
  return {...state,humanRequested:false};
}
export function shouldAiResume(state:Ownership, now:string):boolean {
  if(state.owner!=="human"||state.humanRequested||!state.lastHumanActivityAt)return false;
  const last=Date.parse(state.lastHumanActivityAt),current=Date.parse(now);
  return Number.isFinite(last)&&Number.isFinite(current)&&current>=last+HUMAN_IDLE_MS;
}
export function resumeAi(state:Ownership,now:string):Ownership {
  return shouldAiResume(state,now)?{...state,owner:"ai"}:state;
}
export function canAiSend(state:Ownership):boolean {
  return state.owner==="ai"&&!state.humanRequested;
}
export const initialOwnership:Ownership={owner:"ai",lastHumanActivityAt:null,humanRequested:false};
