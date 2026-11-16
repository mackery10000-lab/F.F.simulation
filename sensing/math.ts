import type {Vec3} from './contracts.ts';
export const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const add=(a:Vec3,b:Vec3):Vec3=>a.map((v,i)=>v+b[i]) as Vec3;
export const sub=(a:Vec3,b:Vec3):Vec3=>a.map((v,i)=>v-b[i]) as Vec3;
export const scale=(a:Vec3,s:number):Vec3=>a.map(v=>v*s) as Vec3;
export const norm=(a:Vec3)=>Math.hypot(...a);
export const dot=(a:Vec3,b:Vec3)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const unit=(a:Vec3):Vec3=>scale(a,1/(norm(a)||1));
export const distance=(a:Vec3,b:Vec3)=>norm(sub(a,b));
export const horizontal=(a:Vec3,b:Vec3)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export const mean=(a:number[])=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
export function random(seed:number){let x=seed>>>0;return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296};}
export function keyedRandom(seed:number,id:string){for(const c of id)seed=Math.imul(seed^c.charCodeAt(0),16777619);return random(seed);}
export function gaussian(rng:()=>number){return Math.sqrt(-2*Math.log(Math.max(rng(),1e-9)))*Math.cos(2*Math.PI*rng());}
export function noisy(p:Vec3,sigma:number,rng:()=>number):Vec3{return p.map(v=>v+gaussian(rng)*sigma) as Vec3;}
/** Weighted Gauss-Newton on range observations, with fixed known tag height. */
export function multilaterate(anchors:Vec3[],ranges:number[],weights:number[],z:number){
  let x=mean(anchors.map(a=>a[0])),y=mean(anchors.map(a=>a[1])),det=0;
  for(let k=0;k<16;k++){
    let a=0,b=0,c=0,gx=0,gy=0;
    anchors.forEach((p,i)=>{const d=Math.max(.01,Math.hypot(x-p[0],y-p[1],z-p[2])),jx=(x-p[0])/d,jy=(y-p[1])/d,w=weights[i],e=d-ranges[i];a+=w*jx*jx;b+=w*jx*jy;c+=w*jy*jy;gx+=w*jx*e;gy+=w*jy*e});
    det=a*c-b*b;if(det<1e-8)return null;
    const dx=(c*gx-b*gy)/det,dy=(a*gy-b*gx)/det;x-=dx;y-=dy;if(Math.hypot(dx,dy)<1e-6)break;
  }
  const residual=Math.sqrt(mean(anchors.map((a,i)=>(Math.hypot(x-a[0],y-a[1],z-a[2])-ranges[i])**2)));
  return {position:[x,y,z] as Vec3,residual,geometry:1/Math.sqrt(det)};
}
/** Hann-windowed DFT/STFT of measured complex CSI, centred in Doppler frequency. */
export function spectrum(real:number[],imag:number[],hz:number){
  const n=Math.min(real.length,imag.length),rows:{frequency:number;power:number}[]=[];
  if(n<4)return rows;
  const mr=mean(real),mi=mean(imag);
  for(let k=-Math.floor(n/2);k<Math.ceil(n/2);k++){
    let re=0,im=0;
    for(let j=0;j<n;j++){const w=.5-.5*Math.cos(2*Math.PI*j/(n-1)),a=-2*Math.PI*k*j/n,r=(real[j]-mr)*w,i=(imag[j]-mi)*w;re+=r*Math.cos(a)-i*Math.sin(a);im+=r*Math.sin(a)+i*Math.cos(a)}
    rows.push({frequency:k*hz/n,power:(re*re+im*im)/(n*n)});
  }
  return rows;
}
