import type {TacticalReport} from './contracts.ts';
export interface HistoricalPatternComparison {
  current:{label:string;simulation_flag:boolean}; past:{label:string;simulation_flag:boolean};
  patterns:{fighter:string;sequence:string;current_count:number;current_samples:number;past_count:number;past_samples:number;current_times:number[];past_times:number[]}[];
}
/** Requires explicitly supplied history; an empty history never invents old fights. */
export function comparePatternReports(current:TacticalReport,past:TacticalReport|null,labels:{current:string;past:string},simulationFlags:{current:boolean;past:boolean}):HistoricalPatternComparison|null{
  if(!past)return null;
  const keys=[...new Set([...current.patterns,...past.patterns].map(p=>p.id))];
  return {current:{label:labels.current,simulation_flag:simulationFlags.current},past:{label:labels.past,simulation_flag:simulationFlags.past},patterns:keys.map(id=>{
    const a=current.patterns.find(p=>p.id===id),b=past.patterns.find(p=>p.id===id),p=a??b!;
    return {fighter:p.fighter,sequence:p.sequence,current_count:a?.count??0,current_samples:a?.denominator??0,past_count:b?.count??0,past_samples:b?.denominator??0,current_times:a?.evidence.map(e=>e.time)??[],past_times:b?.evidence.map(e=>e.time)??[]};
  })};
}
