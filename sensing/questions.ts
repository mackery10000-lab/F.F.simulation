/** Deterministic analysis of sensor output only. Never imports motion/script labels. */
import type {DistancePoint,Fighter,Hand,MatchEvent,Punch,SimulationRun} from './contracts.ts';

export const ANALYSIS_VERSION='tactics-1.0';
export const TECHNIQUES=['Jab','Cross','Hook','Uppercut'] as const;
export const LABELS:Record<Punch|'all',string>={Jab:'잽',Cross:'크로스',Hook:'훅',Uppercut:'어퍼컷',Uncertain:'미확인',all:'전체 펀치'};
export type TemplateId='sequence'|'response'|'opponent'|'distance_change'|'tempo'|'comparison'|'quality';
export type RequestPhase='pre'|'live'|'post';
export type ResultPhase='live_focus'|'final_focus'|'final_deep';
export interface Parameters {technique:Punch|'all';window:number;start:number;end:number|null;hand:'all'|Hand;}
export interface AnalysisRequest {requestId:string;matchId:string;phase:RequestPhase;templateId:TemplateId;fighterId:Fighter;parameters:Parameters;createdAt:string;}
export interface Template {
  templateId:TemplateId;phase:RequestPhase[];title:string;questionFormat:string;fighterOptions:Fighter[];
  parameters:string[];requiredCapabilities:string[];requiredMeasurements:string[];
  primaryMetric:string;supportingMetrics:string[];contextMetrics:string[];opponentInteractionMetrics:string[];
  evidenceFields:string[];sampleRequirements:string;analysisFunction:string;tacticalInterpretationRules:string[];
  coachingRecommendationRules:string[];limitations:string[];validationTests:string[];
}
const contracts=[
  ['sequence','공격 연계','[선수]가 [기술] 이후 가장 자주 연결한 다음 공격은?', '최다 후속 기술', ['연결 비율','연결 시간 분포','후속 미관측·미확인'], ['시간 구간별 연계','반복 구간'], ['연결 사이 상대 공격'], ['완료된 관측창만 분모에 포함','동일 선수의 첫 후보만 검사','미확인 후보를 건너뛰지 않음']],
  ['response','상대 공격 이후','[선수]는 상대의 [기술] 이후 어떤 공격을 얼마나 빨리 시도했는가?', '최다 후속 기술', ['후속 공격 비율','시간 분포','상대 기술별 비교'], ['시간 구간별 차이'], ['상대 공격 종료 → 대상 선수 첫 공격'], ['시간 순서는 인과·카운터 성공이 아님']],
  ['opponent','공격 후 상대 행동','[선수]가 [기술]을 사용한 후 상대의 다음 공격은 언제, 어떤 기술이었는가?', '상대 최다 후속 기술', ['상대 후속 비율','시간 분포','대상 기술별 비교'], ['시간 구간별 후속 공격'], ['대상 공격 종료 → 상대 첫 공격'], ['방어 빈틈·반격 성공을 측정하지 않음']],
  ['distance_change','공격 전후 거리','[선수]가 [기술]을 시도할 때 공동 거리는 어떻게 변했는가?', '공동 거리 변화 중앙값', ['증가·감소·유지 비율','사분위수','유효 거리 쌍'], ['시간 구간별 거리 변화'], ['두 선수 공동 거리·후속 공격 동반 여부'], ['시작 0.3초 전과 종료 0.3초 후 관측 비교','null·충돌·시간 공백을 보간하지 않음']],
  ['tempo','공격 리듬 변화','[선수]의 공격 빈도와 연계는 선택한 시간 구간에서 어떻게 달라졌는가?', '구간별 분당 관측 공격', ['공격 간격 중앙값','연계 비율'], ['동일 길이 실제 시간 3구간'], ['같은 구간 상대 빈도'], ['시간 구간은 라운드가 아님','체력·피로로 해석하지 않음']],
  ['comparison','동일 조건 선수 비교','[선수]와 상대의 공격 빈도·연계가 같은 관측 구간에서 어떻게 달랐는가?', '대상·상대 연계 비율', ['동일 시간 분당 빈도','기술 분포'], ['양 선수 같은 시간 구간'], ['동일 조건 A/B 지표'], ['선수별 기회 분모 사용','높은 값이 우수함을 뜻하지 않음']],
  ['quality','미확인 기록과 해석 범위','[선수]의 미확인 펀치는 언제 집중되었고 전술 분석을 얼마나 제한하는가?', '미확인 후보 비율', ['WITHHELD·Uncertain 분리','기록된 보류 사유','분류 confidence'], ['시간 구간별 미확인율'], ['상대 미확인율 비교'], ['기록된 사유만 제시','누락된 실제 타격 수는 알 수 없음']],
] as const;
export const TEMPLATES:Template[]=contracts.map(([templateId,title,questionFormat,primaryMetric,supportingMetrics,contextMetrics,opponentInteractionMetrics,rules])=>({
  templateId,title,questionFormat,primaryMetric,phase:templateId==='quality'?['live','post']:['pre','live','post'],fighterOptions:['A','B'],
  parameters:templateId==='quality'?['hand','start','end']:['technique','window','start','end'],
  requiredCapabilities:templateId==='distance_change'?['sensor_punch_events','uwb_series']:['sensor_punch_events'],
  requiredMeasurements:templateId==='distance_change'?['events','distances']:['events'],
  supportingMetrics:[...supportingMetrics],contextMetrics:[...contextMetrics],opponentInteractionMetrics:[...opponentInteractionMetrics],
  evidenceFields:['event_id','fighter_id','hand','event_start','event_end','available_at','classification_confidence','verification_status'],
  sampleRequirements:'전술 제안: 최소 config.minPatternSamples회 + 실제 시간 2구간 이상 반복. 통계적 유의성 기준이 아님.',
  analysisFunction:'analyzeQuestion:'+templateId,tacticalInterpretationRules:[...rules],
  coachingRecommendationRules:['수치와 근거 ID를 연결','희소·단일 구간 표본에서는 제안 보류','측정되지 않은 적중·성공·방어 부위를 추정하지 않음'],
  limitations:['실험적 시뮬레이션 센싱 분류; 독립 검수 정답 없음','완료된 수신 이벤트만 사용; 미관측 타격은 알 수 없음',...rules],
  validationTests:['sensing/tests/questions.test.ts','sensing/tests/questions-report.ts','sensing/tests/questions-browser.mjs'],
}));
export interface Metric {label:string;value:number|null;unit:string;numerator?:number;denominator?:number;}
export interface Evidence {eventId:string;fighterId:Fighter;time:number;end:number;availableAt:number;relatedEventId?:string;relatedFighterId?:Fighter;relatedTime?:number;gap?:number;distanceBefore?:number;distanceAfter?:number;distanceBeforeTime?:number;distanceAfterTime?:number;}
export interface Finding {text:string;evidenceIds:string[];}
export interface AnalysisResult {
  resultId:string;requestId:string;resultPhase:ResultPhase;status:'ready'|'insufficient'|'waiting';calculatedAt:string;sourceDataVersion:string;
  primaryResult:string;supportingMetrics:Metric[];contextualAnalysis:Finding[];opponentInteraction:Finding[];
  tacticalInterpretation:Finding[];coachingRecommendations:Finding[];evidence:Evidence[];
  confidence:{validSamples:number;excluded:number;uncertain:number;withheld:number;meanClassification:number|null;rightCensored:number;conflictingIds:number;};
  limitations:string[];processedUntil:number;
}
export const defaults=():Parameters=>({technique:'Jab',window:1.2,start:0,end:null,hand:'all'});
export function questionText(r:Pick<AnalysisRequest,'templateId'|'fighterId'|'parameters'>){return TEMPLATES.find(t=>t.templateId===r.templateId)!.questionFormat.replace('[선수]',r.fighterId+' 선수').replace('[기술]',LABELS[r.parameters.technique]);}
export function fingerprint(value:unknown){const s=JSON.stringify(value);let a=2166136261,b=5381;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b,33)^s.charCodeAt(i)}return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+'-'+s.length;}
export function sourceVersion(run:SimulationRun,time:number){return ANALYSIS_VERSION+'-'+fingerprint([run.config,run.source,run.events,run.distances,time]);}
const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null;
function quantile(v:number[],p:number){if(!v.length)return null;const a=[...v].sort((a,b)=>a-b),i=(a.length-1)*p;return a[Math.floor(i)]+(a[Math.ceil(i)]-a[Math.floor(i)])*(i%1);}
const pct=(n:number,d:number)=>d?100*n/d:null;
const fmt=(n:number|null,d=1)=>n===null?'미관측':n.toFixed(d);
const known=(e:MatchEvent)=>e.verification_status==='SIMULATED_FUSED'&&TECHNIQUES.includes(e.detected_action as typeof TECHNIQUES[number]);
const valid=(e:MatchEvent)=>['A','B'].includes(e.fighter_id)&&['L','R'].includes(e.hand)&&Number.isFinite(e.event_start)&&e.event_start>=0&&Number.isFinite(e.event_end)&&e.event_end>=e.event_start&&Number.isFinite(e.available_at)&&e.available_at>=e.event_end&&Number.isFinite(e.classification_confidence)&&e.classification_confidence>=0&&e.classification_confidence<=1&&['SIMULATED_FUSED','WITHHELD'].includes(e.verification_status)&&Object.hasOwn(LABELS,e.detected_action);
export function cleanEvents(events:MatchEvent[],time:number){
  const unique=new Map<string,MatchEvent>(),conflicts=new Set<string>();let invalid=0;
  for(const e of events){if(!valid(e)){invalid++;continue}if(e.available_at>time||e.event_end>time)continue;const prior=unique.get(e.event_id);if(prior&&JSON.stringify(prior)!==JSON.stringify(e))conflicts.add(e.event_id);else unique.set(e.event_id,e)}
  return {events:[...unique.values()].filter(e=>!conflicts.has(e.event_id)).sort((a,b)=>a.event_start-b.event_start||a.event_id.localeCompare(b.event_id)),invalid,conflicts:conflicts.size};
}
function evidence(e:MatchEvent,next?:MatchEvent):Evidence{return {eventId:e.event_id,fighterId:e.fighter_id,time:e.event_start,end:e.event_end,availableAt:e.available_at,...(next?{relatedEventId:next.event_id,relatedFighterId:next.fighter_id,relatedTime:next.event_start,gap:next.event_start-e.event_end}:{} )};}
const finding=(text:string,events:MatchEvent[]):Finding=>({text,evidenceIds:events.map(e=>e.event_id)});
function assertRequest(r:AnalysisRequest){
  const p=r.parameters;
  if(!TEMPLATES.some(t=>t.templateId===r.templateId&&t.phase.includes(r.phase))||!['A','B'].includes(r.fighterId)||!['pre','live','post'].includes(r.phase)||!TECHNIQUES.includes(p.technique as typeof TECHNIQUES[number])&&p.technique!=='all'||![.6,1.2,2].includes(p.window)||!['all','L','R'].includes(p.hand)||!Number.isFinite(p.start)||p.start<0||p.end!==null&&(!Number.isFinite(p.end)||p.end<=p.start))throw Error('지원되는 질문·선수·기술·시간 조건을 선택하세요.');
}
export function validateRequest(r:AnalysisRequest){assertRequest(r);return r;}
type Link={base:MatchEvent;next?:MatchEvent;unresolved:boolean;};
function links(bases:MatchEvent[],all:MatchEvent[],actor:Fighter,end:number,window:number){
  const eligible=bases.filter(e=>e.event_end+window<=end+1e-8);
  const rows:Link[]=eligible.map(base=>{
    // Include overlapping/uncertain/withheld next candidates as barriers. Do not
    // skip them and label a later attack as the immediate next attack.
    const next=all.find(e=>e.fighter_id===actor&&e.event_id!==base.event_id&&e.event_start>=base.event_start&&e.event_start<=base.event_end+window);
    const unresolved=!!next&&(!known(next)||next.event_start<base.event_end);
    return {base,next:unresolved?undefined:next,unresolved};
  });return {rows,censored:bases.length-eligible.length};
}
function groupIndex(time:number,start:number,end:number){return Math.min(2,Math.max(0,Math.floor(3*(time-start)/Math.max(.001,end-start))));}
function groupLabel(i:number,start:number,end:number){return `${(start+(end-start)*i/3).toFixed(2)}–${(start+(end-start)*(i+1)/3).toFixed(2)}초`;}
function pointAt(points:DistancePoint[],time:number){let low=0,high=points.length-1,index=-1;while(low<=high){const mid=(low+high)>>1;if(points[mid].time<=time+1e-8){index=mid;low=mid+1}else high=mid-1}const p=points[index];return p&&time-p.time<=.151&&p.distance!==null&&Number.isFinite(p.distance)&&p.distance>=0&&!p.conflict&&p.confidence>0?p:undefined;}

export function analyzeQuestion(run:SimulationRun,request:AnalysisRequest,time:number,resultPhase:ResultPhase,version=sourceVersion(run,time)):AnalysisResult{
  assertRequest(request);
  if(!Number.isFinite(time)||time<0||time>run.config.duration+1e-6)throw Error('처리된 경기 시각이 유효하지 않습니다.');
  if(request.phase==='pre'?(resultPhase==='final_deep'):(resultPhase!=='final_deep'))throw Error('요청과 답변 영역이 일치하지 않습니다.');
  const p=request.parameters,start=p.start,end=Math.min(time,p.end??time),opponent:Fighter=request.fighterId==='A'?'B':'A';
  const clean=cleanEvents(run.events,end),events=clean.events.filter(e=>e.event_start>=start&&e.event_start<end),own=events.filter(e=>e.fighter_id===request.fighterId),other=events.filter(e=>e.fighter_id===opponent);
  const typed=own.filter(known),selected=typed.filter(e=>p.technique==='all'||e.detected_action===p.technique),seconds=Math.max(0,end-start);
  const result:AnalysisResult={resultId:request.requestId+':'+resultPhase,requestId:request.requestId,resultPhase,status:'insufficient',calculatedAt:new Date().toISOString(),sourceDataVersion:version,
    primaryResult:'유효 관측을 기다리고 있습니다.',supportingMetrics:[],contextualAnalysis:[],opponentInteraction:[],tacticalInterpretation:[],coachingRecommendations:[],evidence:[],
    confidence:{validSamples:0,excluded:own.length-typed.length+clean.invalid,uncertain:own.filter(e=>e.detected_action==='Uncertain'&&e.verification_status!=='WITHHELD').length,withheld:own.filter(e=>e.verification_status==='WITHHELD').length,meanClassification:mean(selected.map(e=>e.classification_confidence)),rightCensored:0,conflictingIds:clean.conflicts},
    limitations:[...TEMPLATES.find(t=>t.templateId===request.templateId)!.limitations,'센싱 confidence는 분류 점수이며 전술 성공 확률·통계적 확실성이 아닙니다.','미확인·보류 후보는 기술 확정 집계에서 제외합니다.','거리값은 공동 허리 태그 수평 거리의 시뮬레이션 단위이며 실측 미터가 아닙니다.'],processedUntil:time};
  if(resultPhase!=='live_focus'&&time<run.config.duration-1e-6){result.status='waiting';result.primaryResult='경기 종료 후 전체 수신 기록으로 계산합니다.';return result;}
  if(seconds<=0)return result;
  const metric=(label:string,value:number|null,unit='',numerator?:number,denominator?:number)=>result.supportingMetrics.push({label,value,unit,numerator,denominator});
  const min=run.config.minPatternSamples;
  const repeat=(rows:MatchEvent[])=>rows.length>=min&&new Set(rows.map(e=>groupIndex(e.event_start,start,end))).size>=2;
  const temporal=(bases:MatchEvent[],rows:Link[])=>{
    for(let i=0;i<3;i++){const opportunity=rows.filter(r=>groupIndex(r.base.event_start,start,end)===i),hits=opportunity.filter(r=>r.next);result.contextualAnalysis.push(finding(`${groupLabel(i,start,end)}: 후속 공격 ${hits.length}/${opportunity.length}개 완결 관측창 (${fmt(pct(hits.length,opportunity.length))}%).`,opportunity.map(r=>r.base)));}
    metric('기준 기술 전체',bases.length,'회');
  };
  if(['sequence','response','opponent'].includes(request.templateId)){
    const bases=request.templateId==='response'?other.filter(e=>known(e)&&(p.technique==='all'||e.detected_action===p.technique)):selected;
    const actor=request.templateId==='opponent'?opponent:request.fighterId;
    const {rows,censored}=links(bases,events,actor,end,p.window),connected=rows.filter(r=>r.next),gaps=connected.map(r=>r.next!.event_start-r.base.event_end);
    const distribution=TECHNIQUES.map(type=>({type,rows:connected.filter(r=>r.next!.detected_action===type)})).sort((a,b)=>b.rows.length-a.rows.length),top=distribution[0],tied=top.rows.length>0&&distribution.filter(d=>d.rows.length===top.rows.length).length>1;
    result.confidence.validSamples=rows.length;result.confidence.rightCensored=censored;result.confidence.meanClassification=mean(rows.map(r=>r.base.classification_confidence));
    result.primaryResult=top.rows.length?`${request.templateId==='opponent'?'상대 ':''}최다 후속 기술: ${distribution.filter(d=>d.rows.length===top.rows.length).map(d=>LABELS[d.type]).join(' · ')}${tied?' (공동 최다)':''} · ${top.rows.length}/${rows.length}회`:'분류된 후속 공격 미관측';
    metric('완결 관측창',rows.length,'개');metric('후속 공격 연결',pct(connected.length,rows.length),'%',connected.length,rows.length);metric('후속 미관측',rows.filter(r=>!r.next&&!r.unresolved).length,'회');metric('미확인·중첩 후속 후보',rows.filter(r=>r.unresolved).length,'회');metric('오른쪽 절단 제외',censored,'회');
    for(const d of distribution)metric(LABELS[d.type]+' 연결',pct(d.rows.length,rows.length),'%',d.rows.length,rows.length);
    metric('연결 간격 중앙값',quantile(gaps,.5),'초');metric('연결 간격 25백분위',quantile(gaps,.25),'초');metric('연결 간격 75백분위',quantile(gaps,.75),'초');
    if(rows.length){const n=rows.length,z=1.96,a=connected.length/n,den=1+z*z/n,center=(a+z*z/(2*n))/den,half=z*Math.sqrt(a*(1-a)/n+z*z/(4*n*n))/den;metric('연결 비율 Wilson 참고 하한',100*(center-half),'%');metric('연결 비율 Wilson 참고 상한',100*(center+half),'%');}
    temporal(bases,rows);
    result.evidence=rows.map(r=>evidence(r.base,r.next));
    if(request.templateId==='sequence'){
      const interrupted=connected.filter(r=>events.some(e=>e.fighter_id===opponent&&known(e)&&e.event_start>=r.base.event_end&&e.event_start<=r.next!.event_start));
      result.opponentInteraction.push(finding(`연결 ${connected.length}회 중 사이에 상대 ${opponent}의 분류된 공격이 관측된 연결 ${interrupted.length}회.`,interrupted.map(r=>r.base)));
    }else{
      result.opponentInteraction.push(finding(`${request.templateId==='response'?'상대 '+opponent+' → 대상 '+request.fighterId:'대상 '+request.fighterId+' → 상대 '+opponent}: 종료 후 ${p.window}초 내 첫 공격 ${connected.length}/${rows.length}회.`,connected.map(r=>r.base)));
      for(const t of TECHNIQUES){const subset=rows.filter(r=>r.base.detected_action===t);if(subset.length)result.contextualAnalysis.push(finding(`${LABELS[t]} 기준: 후속 ${subset.filter(r=>r.next).length}/${subset.length}회.`,subset.map(r=>r.base)));}
    }
    if(top.rows.length){result.tacticalInterpretation.push(finding(`${LABELS[top.type]}은 이 관측창에서 ${top.rows.length}회 나온 후속 공격입니다. ${tied?'공동 최다이므로 단일 우선 기술을 정할 수 없습니다.':'다음 기술을 관찰할 시간적 단서로 검토할 수 있습니다.'}`,top.rows.map(r=>r.base)));
      if(!tied&&repeat(top.rows.map(r=>r.base)))result.coachingRecommendations.push(finding(`${request.fighterId} 선수 중심 관찰 가설: ${LABELS[p.technique]} ${request.templateId==='response'?'상대 공격 종료':'종료'} 후 ${p.window}초 동안 ${request.templateId==='opponent'?'상대의 ':''}${LABELS[top.type]}이 다시 나타나는지 다음 스파링에서 확인하세요. 관측 ${top.rows.length}회, 간격 중앙값 ${fmt(quantile(top.rows.map(r=>r.next!.event_start-r.base.event_end),.5),2)}초를 재검증 기준으로 삼을 수 있습니다.`,top.rows.map(r=>r.base)));}
    result.limitations.push(`종료 후 ${p.window}초는 분석용 관측창이며 검증된 콤비네이션·반응 기준이 아닙니다.`,`완결되지 않은 관측창은 양성·음성 모두 분모에서 제외합니다.`,`상대 반응 창은 겹칠 수 있어 같은 상대 공격이 여러 기준 이벤트에 연결될 수 있습니다.`,`Wilson 구간은 독립 이항 시행을 가정한 참고값입니다. 겹친 관측창의 유의성·예측 확률을 뜻하지 않습니다.`);
  }else if(request.templateId==='distance_change'){
    const points=run.distances.filter(d=>d.time<=end).sort((a,b)=>a.time-b.time),pairs:{event:MatchEvent;before:DistancePoint;after:DistancePoint;delta:number;tolerance:number}[]=[];
    for(const event of selected){if(event.event_start-.3<start||event.event_end+.3>end)continue;const before=pointAt(points,event.event_start-.3),after=pointAt(points,event.event_end+.3);if(!before||!after)continue;
      const between=points.filter(d=>d.time>=before.time&&d.time<=after.time);
      if(between.some((d,i)=>d.distance===null||!Number.isFinite(d.distance)||d.conflict||d.confidence<=0||i>0&&d.time-between[i-1].time>.151))continue;
      if(before.uncertainty===null||after.uncertainty===null||!Number.isFinite(before.uncertainty)||!Number.isFinite(after.uncertainty))continue;
      pairs.push({event,before,after,delta:after.distance!-before.distance!,tolerance:Math.max(0,before.uncertainty)+Math.max(0,after.uncertainty)});
    }
    const changes=pairs.map(v=>v.delta),up=pairs.filter(v=>v.delta>v.tolerance),down=pairs.filter(v=>v.delta< -v.tolerance),steady=pairs.length-up.length-down.length;
    result.confidence.validSamples=pairs.length;result.confidence.excluded+=selected.length-pairs.length;
    result.primaryResult=pairs.length?`공동 거리 변화 중앙값: ${fmt(quantile(changes,.5),3)} 시뮬레이션 단위`:'공격 전후의 연속 유효 거리 쌍이 없습니다.';
    metric('유효 거리 쌍',pairs.length,'쌍',pairs.length,selected.length);metric('거리 증가',pct(up.length,pairs.length),'%',up.length,pairs.length);metric('거리 감소',pct(down.length,pairs.length),'%',down.length,pairs.length);metric('불확실성 범위 내 변화',pct(steady,pairs.length),'%',steady,pairs.length);metric('거리 변화 25백분위',quantile(changes,.25),'단위');metric('거리 변화 75백분위',quantile(changes,.75),'단위');
    for(let i=0;i<3;i++){const rows=pairs.filter(v=>groupIndex(v.event.event_start,start,end)===i);result.contextualAnalysis.push(finding(`${groupLabel(i,start,end)}: 거리 변화 중앙값 ${fmt(quantile(rows.map(v=>v.delta),.5),3)} 단위 · 유효 ${rows.length}쌍.`,rows.map(v=>v.event)));}
    const following=pairs.filter(v=>events.some(e=>e.fighter_id===opponent&&known(e)&&e.event_start>=v.event.event_end&&e.event_start<=v.after.time));
    result.opponentInteraction.push(finding(`유효 ${pairs.length}쌍 중 종료 후 0.3초 내 상대 공격 동반 ${following.length}회. 공동 거리 변화의 선수별 기여는 분리하지 않았습니다.`,following.map(v=>v.event)));
    result.evidence=pairs.map(v=>({...evidence(v.event),distanceBefore:v.before.distance!,distanceAfter:v.after.distance!,distanceBeforeTime:v.before.time,distanceAfterTime:v.after.time}));
    const dominant=up.length>down.length?up:down;
    if(pairs.length)result.tacticalInterpretation.push(finding(`공격 전후 공동 거리는 증가 ${up.length}회·감소 ${down.length}회·관측 불확실성 범위 ${steady}회입니다. 선수별 전진·후퇴나 거리 주도권을 뜻하지 않습니다.`,pairs.map(v=>v.event)));
    if(dominant.length>pairs.length/2&&repeat(dominant.map(v=>v.event)))result.coachingRecommendations.push(finding(`${request.fighterId} 선수의 ${LABELS[p.technique]} 전후 ${up.length>down.length?'공동 거리 증가':'공동 거리 감소'}가 반복되는지 다음 스파링에서 관찰하세요. 양 선수 움직임을 함께 확인해 원인을 검증할 수 있습니다.`,dominant.map(v=>v.event)));
    result.limitations.push('증가·감소는 전후 uncertainty 합보다 큰 변화만 분류합니다. 그 이하는 불확실성 범위로 표시합니다.');
  }else if(request.templateId==='quality'){
    const rows=own.filter(e=>p.hand==='all'||e.hand===p.hand),unresolved=rows.filter(e=>!known(e)),otherRows=other.filter(e=>p.hand==='all'||e.hand===p.hand);
    result.confidence.validSamples=rows.length;result.confidence.meanClassification=mean(rows.map(e=>e.classification_confidence));
    result.primaryResult=rows.length?`미확인 후보: ${unresolved.length}/${rows.length}건 (${fmt(pct(unresolved.length,rows.length))}%)`:'해당 손의 수신 후보 기록이 없습니다.';
    metric('미확인·보류 합집합',pct(unresolved.length,rows.length),'%',unresolved.length,rows.length);metric('WITHHELD',rows.filter(e=>e.verification_status==='WITHHELD').length,'건');metric('Uncertain (보류 제외)',rows.filter(e=>e.verification_status!=='WITHHELD'&&e.detected_action==='Uncertain').length,'건');
    for(let i=0;i<3;i++){const subset=rows.filter(e=>groupIndex(e.event_start,start,end)===i);result.contextualAnalysis.push(finding(`${groupLabel(i,start,end)}: 미확인 ${subset.filter(e=>!known(e)).length}/${subset.length}건 (${fmt(pct(subset.filter(e=>!known(e)).length,subset.length))}%).`,subset));}
    for(const reason of [...new Set(unresolved.map(e=>e.reason))]){const subset=unresolved.filter(e=>e.reason===reason);result.contextualAnalysis.push(finding(`기록된 판정 사유: ${reason||'사유 미기록'} · ${subset.length}건.`,subset));}
    result.opponentInteraction.push(finding(`상대 ${opponent}의 같은 손 조건: 미확인 ${otherRows.filter(e=>!known(e)).length}/${otherRows.length}건. 검출되지 않은 실제 타격 수는 비교할 수 없습니다.`,otherRows));
    result.evidence=rows.map(e=>evidence(e));
    if(unresolved.length)result.tacticalInterpretation.push(finding(`미확인 ${unresolved.length}건은 후속 기술을 확정할 수 없는 기록입니다. 이 구간의 연계를 선수의 고정 습관으로 확대 해석하지 마세요.`,unresolved));
  }else{
    const ownRows=selected,opponentRows=other.filter(e=>known(e)&&(p.technique==='all'||e.detected_action===p.technique));
    const a=links(ownRows,events,request.fighterId,end,p.window),b=links(opponentRows,events,opponent,end,p.window);
    const ac=a.rows.filter(r=>r.next).length,bc=b.rows.filter(r=>r.next).length;
    result.confidence.validSamples=ownRows.length;result.confidence.rightCensored=a.censored;result.evidence=[...ownRows,...opponentRows].map(e=>evidence(e));
    metric(`${request.fighterId} 분당 분류 공격`,60*ownRows.length/seconds,'회/분',ownRows.length,seconds);metric(`${opponent} 분당 분류 공격`,60*opponentRows.length/seconds,'회/분',opponentRows.length,seconds);metric(`${request.fighterId} 연계`,pct(ac,a.rows.length),'%',ac,a.rows.length);metric(`${opponent} 연계`,pct(bc,b.rows.length),'%',bc,b.rows.length);
    metric('대상 공격 간격 중앙값',quantile(ownRows.slice(1).map((e,i)=>e.event_start-ownRows[i].event_start),.5),'초');
    for(const type of TECHNIQUES){metric(`${request.fighterId} ${LABELS[type]}`,ownRows.filter(e=>e.detected_action===type).length,'회');metric(`${opponent} ${LABELS[type]}`,opponentRows.filter(e=>e.detected_action===type).length,'회');}
    const counts:number[]=[];
    for(let i=0;i<3;i++){const rows=ownRows.filter(e=>groupIndex(e.event_start,start,end)===i),rivals=opponentRows.filter(e=>groupIndex(e.event_start,start,end)===i),windows=a.rows.filter(r=>groupIndex(r.base.event_start,start,end)===i);counts.push(rows.length);result.contextualAnalysis.push(finding(`${groupLabel(i,start,end)}: ${request.fighterId} ${fmt(180*rows.length/seconds)}회/분 (${rows.length}회), 상대 ${opponent} ${fmt(180*rivals.length/seconds)}회/분 (${rivals.length}회) · 대상 연계 ${windows.filter(r=>r.next).length}/${windows.length}개 완결 창.`,[...rows,...rivals]));}
    result.primaryResult=request.templateId==='comparison'?`${request.fighterId} 연계 ${fmt(pct(ac,a.rows.length))}% (${ac}/${a.rows.length}) · 상대 ${opponent} ${fmt(pct(bc,b.rows.length))}% (${bc}/${b.rows.length})`:`시간 3구간의 분당 공격: ${counts.map(n=>fmt(180*n/seconds)).join(' → ')}회`;
    result.opponentInteraction.push(finding(`같은 ${start.toFixed(2)}–${end.toFixed(2)}초에서 대상 ${ownRows.length}회, 상대 ${opponentRows.length}회. 센서 누락 차이를 보정한 실제 공격률은 아닙니다.`,opponentRows));
    if(ownRows.length)result.tacticalInterpretation.push(finding(request.templateId==='comparison'?`연계 비율은 각 선수의 완결 관측창 ${a.rows.length}개와 ${b.rows.length}개를 분모로 계산했습니다. 공격 성과나 우열을 나타내지 않습니다.`:`같은 길이 시간 구간의 관측 공격이 ${counts.join(' → ')}회로 변했습니다. 실제 라운드 변화나 체력 저하는 측정하지 않았습니다.`,ownRows));
    if(repeat(ownRows)&&request.templateId==='tempo'&&counts[0]!==counts[2])result.coachingRecommendations.push(finding(`${request.fighterId} 선수의 관측 공격이 첫 구간 ${counts[0]}회에서 마지막 구간 ${counts[2]}회로 변했습니다. 다음 훈련에서 같은 시간 폭의 공격 간격과 연계 변화를 함께 확인하고, 검출 누락의 영향도 확인하세요.`,ownRows));
    if(request.templateId==='comparison'&&repeat(ownRows)&&repeat(opponentRows)&&a.rows.length>=min&&b.rows.length>=min&&ac/a.rows.length!==bc/b.rows.length)result.coachingRecommendations.push(finding(`${request.fighterId}와 ${opponent}의 동일 조건 연계 차이 (${ac}/${a.rows.length} 대 ${bc}/${b.rows.length})가 다음 스파링에서도 유지되는지 관찰하세요. 현재 차이를 우열이나 성공률로 해석하지 마세요.`,[...ownRows,...opponentRows]));
    result.limitations.push('분당 빈도 분모는 선택한 실제 처리 시간입니다. 유효 센서 관측 시간으로 보정한 값이 아닙니다.');
  }
  result.status=result.confidence.validSamples>0?'ready':'insufficient';
  if(!result.coachingRecommendations.length)result.limitations.push('반복 표본·구간 또는 대응 근거가 부족해 코칭 제안을 보류했습니다.');
  return result;
}

/** Exact input cache keys, bounded memory; fingerprints are display versions only. */
export class QuestionCache {
  private values=new Map<string,AnalysisResult>();
  restore(run:SimulationRun,r:AnalysisRequest,time:number,phase:ResultPhase,result:AnalysisResult){if(result.sourceDataVersion===sourceVersion(run,time)&&result.requestId===r.requestId&&result.resultPhase===phase){const key=JSON.stringify([ANALYSIS_VERSION,run.config,run.source,run.events,run.distances,r,time,phase]);this.values.set(key,result);}}
  calculate(run:SimulationRun,r:AnalysisRequest,time:number,phase:ResultPhase){const key=JSON.stringify([ANALYSIS_VERSION,run.config,run.source,run.events,run.distances,r,time,phase]);const found=this.values.get(key);if(found)return found;const value=analyzeQuestion(run,r,time,phase);this.values.set(key,value);if(this.values.size>40)this.values.delete(this.values.keys().next().value!);return value;}
}
