import type {Arena,SimulationConfig} from './contracts.ts';
import {videoMotionSource} from './adapters.ts';
import type {ExistingMotion} from './adapters.ts';
import {LiveSensingSession} from './live.ts';
let session:LiveSensingSession|null=null;
self.onmessage=(event:MessageEvent<{id:number;type:'init'|'advance'|'export';motion?:ExistingMotion;arena?:Arena;config?:SimulationConfig;time?:number}>)=>{
  const {id,type}=event.data;
  try{
    if(type==='init'){
      const {motion,arena,config}=event.data;if(!motion||!arena||!config)throw Error('기존 선수 3D 모션이 필요합니다.');
      session=new LiveSensingSession(videoMotionSource(motion),arena,config,motion.fps);
      self.postMessage({id,snapshot:session.advance(0)});
    }else if(!session)throw Error('실시간 센싱 세션을 먼저 초기화하세요.');
    else if(type==='advance'){
      const target=event.data.time??0;
      self.postMessage({id,snapshot:session.advance(target)});
    }else self.postMessage({id,run:session.run(true)});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)})}
};
