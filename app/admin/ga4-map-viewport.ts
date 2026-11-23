export type AnalyticsMapView="vietnam"|"world";
export type MapPoint={x:number;y:number};
export type MapViewport={x:number;y:number;width:number;height:number;scale:number;offsetX:number;offsetY:number};

// Center on the bounds of Vietnam's bundled polygon, not its country marker.
// Both presets use the existing Natural Earth projection and country aggregates.
export function analyticsMapViewport(view:AnalyticsMapView,size:{width:number;height:number}):MapViewport {
 const measured=Number.isFinite(size.width)&&Number.isFinite(size.height)&&size.width>0&&size.height>0;
 const height=view==="vietnam"?56:420;
 const width=view==="vietnam"?Math.max(32,height*(measured?size.width/size.height:800/420)):800;
 const x=view==="vietnam"?629.55-width/2:0;
 const y=view==="vietnam"?198.6-height/2:0;
 const scale=measured?Math.min(size.width/width,size.height/height):1;
 return {x,y,width,height,scale,offsetX:measured?(size.width-width*scale)/2:0,offsetY:measured?(size.height-height*scale)/2:0};
}
export function pointInMapViewport(point:MapPoint,view:MapViewport) {
 return point.x>=view.x&&point.x<=view.x+view.width&&point.y>=view.y&&point.y<=view.y+view.height;
}
export function projectMapPoint(point:MapPoint,view:MapViewport):MapPoint {
 return {x:view.offsetX+(point.x-view.x)*view.scale,y:view.offsetY+(point.y-view.y)*view.scale};
}
