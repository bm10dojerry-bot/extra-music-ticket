function clamp01(value:number):number {
 return Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;
}

function smoothStep(value:number):number {
 const x=clamp01(value);
 return x*x*(3-2*x);
}

export function getStageProgress(top:number,height:number):number {
 if(!Number.isFinite(top)||!Number.isFinite(height)||height<=0)return 0;
 return smoothStep(-top/Math.max(240,height*.72));
}

export function getStageMotion(progress:number):{open:number;logoOpacity:number;copyOpacity:number;lightOpacity:number} {
 const open=clamp01(progress);
 return {
  open,
  logoOpacity:1-smoothStep((open-.05)/(.64-.05)),
  copyOpacity:1-smoothStep((open-.12)/(.78-.12)),
  lightOpacity:1-smoothStep((open-.28)/(.92-.28)),
 };
}
