/** Causal UWB-only constant-velocity filters; positions never use camera truth. */
import type {Measurement,TagEstimate,UwbValue,Vec3} from './contracts.ts';
import {clamp} from './math.ts';
type Axis={p:number;v:number;pp:number;pv:number;vv:number};
function predict(a:Axis,dt:number,accelerationVariance:number):Axis{
  return {p:a.p+a.v*dt,v:a.v,pp:a.pp+2*dt*a.pv+dt*dt*a.vv+accelerationVariance*dt**4/4,
    pv:a.pv+dt*a.vv+accelerationVariance*dt**3/2,vv:a.vv+accelerationVariance*dt*dt};
}
export class TagFilter {
  private axes:Axis[]|null=null;
  private time=-Infinity;
  private z=0;
  private quality=0;
  private id:string|null=null;
  private exact=false;
  private accelerationVariance=4;
  private observation:{position:Vec3;uncertainty:number}|null=null;
  readonly expiry_s=.6;
  update(m:Measurement){
    const value=m.measurement_value as UwbValue,position=value.position;
    if(m.sensor_type!=='uwb'||!position||position.some(n=>!Number.isFinite(n))||!Number.isFinite(m.timestamp)||m.timestamp<=this.time||
      m.confidence<.2||m.data_quality<.2||!Number.isFinite(value.error_radius_m)||value.error_radius_m<0)return;
    const variance=Math.max(1e-12,(value.error_radius_m/2)**2),dt=m.timestamp-this.time;
    const exact=value.error_radius_m<1e-8;
    if(!this.axes||dt>this.expiry_s){
      this.axes=position.slice(0,2).map(p=>({p,v:0,pp:variance,pv:0,vv:1}));
    }else{
      const before=this.axes,preliminary=before.map(a=>predict(a,dt,this.accelerationVariance));
      const excess=Math.max(0,Math.hypot(...preliminary.map((a,i)=>position[i]-a.p))-4*Math.sqrt(variance));
      // Increase responsiveness only when innovations exceed observation noise.
      // Quiet tracks keep a useful prediction horizon; abrupt motion widens it.
      const processVariance=Math.max(4,this.accelerationVariance*.5,Math.min(400,(excess/Math.max(.01,dt*dt))**2));
      const prior=before.map(a=>predict(a,dt,processVariance));
      // Reject isolated inconsistent fixes; expiry allows a genuine reacquisition.
      const innovation=prior.reduce((sum,a,i)=>sum+(position[i]-a.p)**2/(a.pp+variance),0);
      if(!exact&&innovation>36)return;
      this.accelerationVariance=processVariance;
      this.axes=prior.map((a,i)=>{
        if(exact)return {p:position[i],v:(position[i]-before[i].p)/dt,pp:variance,pv:0,vv:a.vv};
        const s=a.pp+variance,kp=a.pp/s,kv=a.pv/s,e=position[i]-a.p;
        return {p:a.p+kp*e,v:a.v+kv*e,pp:Math.max(0,(1-kp)*a.pp),pv:(1-kp)*a.pv,vv:Math.max(0,a.vv-kv*a.pv)};
      });
    }
    this.time=m.timestamp;this.z=position[2];this.quality=m.confidence;this.id=m.measurement_id??`${m.sensor_id}:${m.timestamp}`;this.exact=exact;
    this.observation={position:[...position],uncertainty:value.error_radius_m};
  }
  at(now:number,observedAge:number):TagEstimate{
    const age=now-this.time;
    if(!this.axes)return {status:'UNAVAILABLE',position:null,confidence:0,uncertainty:null,age_s:null,measurement_id:null};
    if(age>this.expiry_s||age<0)return {status:'EXPIRED',position:null,confidence:0,uncertainty:null,age_s:age,measurement_id:this.id};
    const predicting=age>observedAge;
    // Preserve a recent, high-quality fix instead of introducing filter lag
    // into rapid motion. Filter/predict remains explicit for weaker fixes/gaps.
    if(!predicting&&this.observation&&this.quality>=.65&&this.observation.uncertainty<.15)return {
      status:'OBSERVED',position:[...this.observation.position],confidence:this.quality,uncertainty:this.observation.uncertainty,age_s:age,measurement_id:this.id};
    // Do not extrapolate ordinary packet holds through discontinuous source
    // reacquisitions. Missing packets use explicit bounded prediction.
    const axes=this.axes.map(a=>predict(a,predicting?age:0,this.accelerationVariance));
    const uncertainty=2*Math.sqrt(Math.max(...axes.map(a=>a.pp)));
    const speed=Math.hypot(...this.axes.map(a=>a.v));
    // A fast re-acquisition is not evidence that a large extrapolated movement
    // will continue through an outage. Abstain instead of drawing a long tail.
    if(predicting&&(uncertainty>.5||speed>2||speed*age>.35))return {status:'EXPIRED',position:null,confidence:0,uncertainty,age_s:age,measurement_id:this.id};
    const position=[axes[0].p,axes[1].p,this.z] as Vec3;
    return {status:predicting?'PREDICTED':this.exact?'OBSERVED':'FILTERED',position,
      confidence:clamp(this.quality*(predicting?Math.exp(-age/this.expiry_s):1)),uncertainty,age_s:age,measurement_id:this.id};
  }
}
