import {useCallback,useEffect,useRef,useState} from 'react';
import sceneConfig from '../../../data/scene.json';
import type {SimulationConfig,SimulationRun} from '../../../sensing/contracts.ts';
import type {ExistingMotion} from '../../../sensing/adapters.ts';
import {videoMotionSource} from '../../../sensing/adapters.ts';
import type {LiveSnapshot} from '../../../sensing/live.ts';
import {DEFAULT_CONFIG} from '../../../sensing/sensors.ts';
const o=sceneConfig.octagon,arena={vertices:o.inside_vertices_xy_m,canvasZ:o.canvas_z_m,fenceHeight:o.fence_height_above_canvas_m};
interface Reply {snapshot?:LiveSnapshot;run?:SimulationRun;error?:string;}
export function useLiveSensing(){
  const [motion,setMotion]=useState<ExistingMotion|null>(null),[snapshot,setSnapshot]=useState<LiveSnapshot|null>(null),[error,setError]=useState('');
  const [config,setConfig]=useState<SimulationConfig>(()=>({...structuredClone(DEFAULT_CONFIG),duration:180,scenario:'video_model'}));
  const [playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[busy,setBusy]=useState(true),[reload,setReload]=useState(0);
  const worker=useRef<Worker|null>(null),pending=useRef(new Map<number,{resolve:(r:Reply)=>void;reject:(e:Error)=>void}>()),ids=useRef(0),latest=useRef<LiveSnapshot|null>(null),advancing=useRef(false),clock=useRef({time:0,wall:0}),playingRef=useRef(false),epoch=useRef(0);
  playingRef.current=playing;
  const publish=useCallback((next:LiveSnapshot)=>{const prior=latest.current;const stable={...next,devices:prior?.devices??next.devices,config:prior?.config??next.config};latest.current=stable;setSnapshot(stable)},[]);
  const command=useCallback((type:string,data:Record<string,unknown>={}):Promise<Reply>=>new Promise((resolve,reject)=>{
    if(!worker.current)return reject(Error('실시간 센싱 엔진 연결 전입니다.'));const id=++ids.current;
    pending.current.set(id,{resolve,reject});worker.current.postMessage({id,type,...data});
  }),[]);
  useEffect(()=>{const controller=new AbortController();setBusy(true);setError('');
    fetch('/api/sensing-motion',{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error??'가상 경기 환경을 준비할 수 없습니다.');videoMotionSource(data);setMotion(data)})
      .catch(e=>{if(!controller.signal.aborted){setError(String(e));setBusy(false)}});return ()=>controller.abort();
  },[reload]);
  useEffect(()=>{if(!motion)return;
    const resume=latest.current?.time??0,wasPlaying=latest.current?playingRef.current:false;epoch.current++;
    const engine=new Worker(new URL('../../../sensing/live-worker.ts',import.meta.url),{type:'module'});worker.current=engine;let alive=true;setBusy(true);setPlaying(false);setError('');
    engine.onmessage=(event:MessageEvent<Reply&{id:number}>)=>{const task=pending.current.get(event.data.id);pending.current.delete(event.data.id);if(event.data.error)task?.reject(Error(event.data.error));else task?.resolve(event.data)};
    engine.onerror=e=>{if(alive){setError('센싱 엔진 오류: '+e.message);setBusy(false)}for(const task of pending.current.values())task.reject(Error(e.message));pending.current.clear()};
    void (async()=>{try{const first=await command('init',{motion,arena,config});latest.current=null;const result=resume>0?await command('advance',{time:Math.min(resume,(motion.frames.length-1)/motion.fps)}):first;if(alive&&result.snapshot){publish(result.snapshot);clock.current={time:result.snapshot.time,wall:performance.now()};advancing.current=false;setBusy(false);setPlaying(wasPlaying)}}catch(e){if(alive){setError(String(e));setBusy(false)}}})();
    return ()=>{alive=false;worker.current=null;engine.terminate();for(const p of pending.current.values())p.reject(Error('센싱 세션 교체'));pending.current.clear()};
  },[motion,config,command,publish]);
  useEffect(()=>{clock.current={time:latest.current?.time??0,wall:performance.now()};if(!playing||busy)return;
    const timer=window.setInterval(()=>{if(advancing.current||!latest.current)return;
      const target=Math.min(latest.current.config.duration,clock.current.time+(performance.now()-clock.current.wall)/1000*speed),requestEpoch=epoch.current;advancing.current=true;
      void command('advance',{time:target}).then(reply=>{if(reply.snapshot&&requestEpoch===epoch.current){publish(reply.snapshot);if(reply.snapshot.time>=reply.snapshot.config.duration)setPlaying(false)}}).catch(e=>{if(requestEpoch===epoch.current)setError(String(e))}).finally(()=>{advancing.current=false});
    },90);return ()=>clearInterval(timer);
  },[playing,speed,busy,command,publish]);
  const seek=useCallback(async(time:number)=>{const requestEpoch=++epoch.current;setPlaying(false);setBusy(true);setError('');try{const result=await command('advance',{time});if(result.snapshot&&requestEpoch===epoch.current){publish(result.snapshot);clock.current={time:result.snapshot.time,wall:performance.now()}}}catch(e){if(requestEpoch===epoch.current)setError(String(e))}finally{if(requestEpoch===epoch.current)setBusy(false)}},[command,publish]);
  return {motion,snapshot,error,playing,speed,busy,config,setConfig,setPlaying,setSpeed,seek,reconnect:()=>setReload(n=>n+1),exportFull:async()=>{const response=await command('export');if(!response.run)throw Error('센싱 내보내기 결과가 없습니다.');return response.run}};
}
