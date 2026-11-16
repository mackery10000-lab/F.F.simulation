import type {SimulationRun} from './contracts.ts';
import {exportRun} from './engine.ts';
export interface SavedSession { id:string; saved_at:string; scenario:string; seed:number; source:string; event_count:number; duration:number; }
function openDatabase():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined')return reject(Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다. JSON 내보내기를 사용하세요.'));
  const req=indexedDB.open('fight-frequency-sensing',1);
  req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('sessions',{keyPath:'id'});const store=db.createObjectStore('events',{keyPath:['session_id','event_id']});store.createIndex('by_session','session_id')};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('다른 탭에서 센싱 DB를 사용 중입니다.'));
});}
export function sessionId(run:SimulationRun){let h=2166136261;for(const c of JSON.stringify([run.config,run.source]))h=Math.imul(h^c.charCodeAt(0),16777619);return 'SIM-'+(h>>>0).toString(16);}
export async function saveSession(run:SimulationRun,time:number):Promise<SavedSession>{
  const db=await openDatabase(),id=sessionId(run),data=exportRun(run,time);
  const session:SavedSession={id,saved_at:new Date().toISOString(),scenario:run.config.scenario,seed:run.config.seed,source:run.source.mode,event_count:data.events.length,duration:Math.min(time,run.config.duration)};
  try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(['sessions','events'],'readwrite'),events=tx.objectStore('events');
    // Replace this run atomically so saving an earlier seek cannot retain future events.
    const cursor=events.index('by_session').openCursor(IDBKeyRange.only(id));cursor.onsuccess=()=>{const row=cursor.result;if(row){row.delete();row.continue()}else{for(const event of data.events)events.put({...event,session_id:id,simulation_flag:true});tx.objectStore('sessions').put({...session,report:{...data,measurements:undefined}})}};
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??Error('저장 취소'));});return session;
  }finally{db.close()}
}
export async function listSessions():Promise<SavedSession[]>{const db=await openDatabase();try{return await new Promise((resolve,reject)=>{const req=db.transaction('sessions').objectStore('sessions').getAll();req.onsuccess=()=>resolve(req.result.map(({report:_,...s})=>s).sort((a:SavedSession,b:SavedSession)=>b.saved_at.localeCompare(a.saved_at)));req.onerror=()=>reject(req.error)})}finally{db.close()}}
export async function loadSession(id:string):Promise<unknown>{const db=await openDatabase();try{return await new Promise((resolve,reject)=>{const req=db.transaction('sessions').objectStore('sessions').get(id);req.onsuccess=()=>resolve(req.result?.report??null);req.onerror=()=>reject(req.error)})}finally{db.close()}}
