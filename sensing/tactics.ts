import type {DistancePoint,Fighter,FighterHabit,MatchEvent,SimulationConfig,TacticalPattern,TacticalReport} from './contracts.ts';
import {mean} from './math.ts';
export function distanceAt(rows:DistancePoint[],time:number){const i=Math.round(time*10);const r=rows[Math.max(0,Math.min(rows.length-1,i))];return r&&Math.abs(r.time-time)<.2?r:undefined;}
export function analyzeTactics(events:MatchEvent[],distances:DistancePoint[],config:SimulationConfig,time=Infinity):TacticalReport{
  const accepted=events.filter(e=>e.available_at<=time&&e.verification_status==='SIMULATED_FUSED'&&e.detected_action!=='Uncertain');
  const patterns:TacticalPattern[]=[],habits:FighterHabit[]=[];
  for(const fighter of ['A','B'] as Fighter[]){
    const rows=accepted.filter(e=>e.fighter_id===fighter),groups=new Map<string,MatchEvent[][]>();
    for(let i=0;i<rows.length;i++)for(const size of [2,3]){
      const slice=rows.slice(i,i+size);if(slice.length!==size||slice.some((e,j)=>j>0&&e.event_start-slice[j-1].event_start>config.combinationWindow))continue;
      const key=slice.map(e=>e.detected_action).join(' → '),prior=groups.get(key)??[];
      if(prior.some(g=>g.some(e=>slice.some(s=>s.event_id===e.event_id))))continue;
      prior.push(slice);groups.set(key,prior);
    }
    for(const [sequence,occurrences] of groups){
      if(occurrences.length<config.minPatternSamples||rows.length<5)continue;
      const first=occurrences[0][0].detected_action,denominator=rows.filter(e=>e.detected_action===first).length;
      patterns.push({id:`${fighter}-${sequence}`,fighter,sequence,count:occurrences.length,denominator,confidence:mean(occurrences.flat().map(e=>e.classification_confidence)),evidence:occurrences.map(group=>{
        const a=distanceAt(distances,group[0].event_start),b=distanceAt(distances,group.at(-1)!.event_end);
        return {event_ids:group.map(e=>e.event_id),time:group[0].event_start,intervals:group.slice(1).map((e,i)=>e.event_start-group[i].event_start),distance_change:a?.distance!==null&&b?.distance!==null&&a?.distance!==undefined&&b?.distance!==undefined?b.distance-a.distance:null};}),interpretation:`선수 ${fighter}: ${first} ${denominator}회 중 ${occurrences.length}회에서 ${sequence} 순서가 관측됨. 시간적 연결이며 적중·의도는 미확정.`});
    }
    const habit:FighterHabit={fighter,punches:rows.length,jabs:rows.filter(e=>e.detected_action==='Jab').length,jabCross:0,retreat:0,distanceSamples:0,attackDistance:null,byRange:{},byZone:{}};
    const starting:number[]=[];
    rows.forEach((e,i)=>{
      if(e.detected_action==='Jab'&&rows[i+1]?.detected_action==='Cross'&&rows[i+1].event_start-e.event_start<=config.combinationWindow)habit.jabCross++;
      const start=distanceAt(distances,e.event_start),end=distanceAt(distances,e.event_end+.9);
      if(start?.distance!==null&&start?.distance!==undefined&&start.confidence>.5&&!start.conflict){starting.push(start.distance);const range=start.distance<1.4?'근거리':start.distance<2.5?'중거리':'원거리';habit.byRange[range]=(habit.byRange[range]??0)+1;
        const pos=start.positions[fighter],zone=pos&&Math.hypot(pos[0],pos[1])>3.4?'케이지 주변':'중앙';habit.byZone[zone]=(habit.byZone[zone]??0)+1;
        if(end&&end.time<=time&&end.distance!==null&&end.confidence>.5&&!end.conflict){habit.distanceSamples++;if(end.distance-start.distance>.25)habit.retreat++}}
    });habit.attackDistance=starting.length?mean(starting):null;habits.push(habit);
  }
  const facts=patterns.map(p=>p.interpretation);
  for(const h of habits)if(h.distanceSamples>=config.minPatternSamples)facts.push(`선수 ${h.fighter}: 타격 후 0.9초 거리 비교 ${h.distanceSamples}표본 중 ${h.retreat}표본에서 허리 거리가 0.25${config.scenario==='video_model'?'표시 단위':'m'} 초과 증가. 인과적 후퇴 판정 아님.`);
  return {patterns:patterns.sort((a,b)=>b.count-a.count||a.sequence.localeCompare(b.sequence)),habits,facts:facts.length?facts:['경향 확인 불충분 · 독립 반복과 유효한 센서 표본을 더 축적하세요.'],
    suggestions:patterns.length?['반복 시퀀스의 대표 장면에서 가드 복귀와 상대 대응을 추가 검수하세요. 자동으로 취약점·대응 성공을 판정하지 않습니다.']:[],
    limitations:['설명 가능한 규칙 기반 코치 요약 · 학습된 AI 성능 아님','동작 분류는 실험적 · 점수는 보정된 확률 아님','방어 성공·시선·심리·의도는 관측하지 않음','과거 경기 비교: 연결 데이터 없음'],pastComparison:null};
}
