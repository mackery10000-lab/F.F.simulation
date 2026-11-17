import {simulate} from './engine.ts';
import {videoMotionSource} from './adapters.ts';
import type {Arena,SimulationConfig} from './contracts.ts';
self.onmessage=(event:MessageEvent<{arena:Arena;config:SimulationConfig;motion?:unknown}>)=>{
  try{const {arena,config,motion}=event.data;self.postMessage({run:simulate(arena,config,motion?videoMotionSource(motion):undefined)})}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}
};
