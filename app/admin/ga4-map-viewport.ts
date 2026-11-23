export type AnalyticsMapView="vietnam"|"world";
export type MapPoint={x:number;y:number};
export type MapViewport={x:number;y:number;width:number;height:number;scale:number;offsetX:number;offsetY:number};

// A regional frame around Vietnam, its offshore island references and neighbours.
// Fit the whole frame before extending the sides to fill wider screens. Pixel
// padding keeps the island captions and map controls clear on narrow phones.
const VIETNAM_REGION={left:610,right:667,top:168,bottom:226};
export function analyticsMapViewport(view:AnalyticsMapView,size:{width:number;height:number}):MapViewport {
 const measured=Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0;
 if(view==="world"){
  const scale=measured?Math.min(size.width/800,size.height/420):1;
  return {x:0,y:0,width:800,height:420,scale,offsetX:measured?(size.width-800*scale)/2:0,offsetY:measured?(size.height-420*scale)/2:0};
 }
 const canvas=measured?size:{width:800,height:420};
 // Proportional limits also keep hidden/transitional tiny layouts finite.
 const paddingX=Math.min(24,canvas.width*.08);
 const paddingTop=Math.min(36,canvas.height*.12),paddingBottom=Math.min(12,canvas.height*.04);
 const scale=Math.min((canvas.width-2*paddingX)/(VIETNAM_REGION.right-VIETNAM_REGION.left),(canvas.height-paddingTop-paddingBottom)/(VIETNAM_REGION.bottom-VIETNAM_REGION.top));
 const width=canvas.width/scale,height=canvas.height/scale;
 const x=(VIETNAM_REGION.left+VIETNAM_REGION.right-width)/2;
 const y=(VIETNAM_REGION.top+VIETNAM_REGION.bottom-height)/2-(paddingTop-paddingBottom)/(2*scale);
 return {x,y,width,height,scale,offsetX:0,offsetY:0};
}
export function pointInMapViewport(point:MapPoint,view:MapViewport) {
 return point.x>=view.x&&point.x<=view.x+view.width&&point.y>=view.y&&point.y<=view.y+view.height;
}
export function projectMapPoint(point:MapPoint,view:MapViewport):MapPoint {
 return {x:view.offsetX+(point.x-view.x)*view.scale,y:view.offsetY+(point.y-view.y)*view.scale};
}
