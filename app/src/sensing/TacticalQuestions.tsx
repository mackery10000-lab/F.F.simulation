import {useEffect,useRef,useState} from 'react';
import type {SimulationRun} from '../../../sensing/contracts.ts';
import {TEMPLATES,TECHNIQUES,LABELS,defaults,QuestionCache,questionText,validateRequest,ANALYSIS_VERSION} from '../../../sensing/questions.ts';
import type {AnalysisRequest,AnalysisResult,Parameters,RequestPhase,ResultPhase,TemplateId} from '../../../sensing/questions.ts';
import {loadQuestions,saveQuestions} from '../../../sensing/question-store.ts';
import type {QuestionArchive} from '../../../sensing/question-store.ts';
import {timecode,FIGHTER_NAMES} from './LiveWidgets.tsx';
import './questions.css';
type Props={started:boolean;ready:boolean;visible:boolean;run:SimulationRun|null;time:number;matchId:string;onStart:(resumeTime?:number)=>void;onSeek:(time:number)=>void;};
const AREAS:{id:ResultPhase;title:string;subtitle:string}[]=[
  {id:'live_focus',title:'경기 중 집중 분석 답변',subtitle:'경기 전 등록 질문 · 현재까지 완료된 수신 기록'},
  {id:'final_focus',title:'경기 후 집중 분석 최종 답변',subtitle:'경기 전 등록 질문 · 경기 전체 기록으로 별도 계산'},
  {id:'final_deep',title:'경기 후 심층 분석 답변',subtitle:'경기 중·후 등록 요청 · 최종 전용 답변'},
];
function ResultCard({result,request,onSeek}:{result:AnalysisResult;request:AnalysisRequest;onSeek:(t:number)=>void}){
  const [allEvidence,setAllEvidence]=useState(false);
  return <article className="tq-answer" data-result-status={result.status} data-result-request={request.requestId}>
    <div className="tq-card-top"><span>{request.fighterId} · {FIGHTER_NAMES[request.fighterId]}</span><small>{result.status==='waiting'?'종료 후 계산':result.status==='insufficient'?'표본 부족':'관측 결과'}</small></div>
    <p className="tq-question">{questionText(request)}</p><h4>{result.primaryResult}</h4>
    {result.status!=='waiting'&&<>
      <dl className="tq-metrics">{result.supportingMetrics.map((m,i)=><div key={i}><dt>{m.label}</dt><dd>{m.value===null?'—':Number.isInteger(m.value)?m.value:m.value.toFixed(2)}<small> {m.unit}</small></dd>{m.denominator!==undefined&&<small>분자 {m.numerator} / 분모 {m.denominator}</small>}</div>)}</dl>
      {([['상황별 관측 사실',result.contextualAnalysis],['상대 선수와의 관계',result.opponentInteraction],['전술적 해석',result.tacticalInterpretation],['코칭 제안 · 검증할 가설',result.coachingRecommendations]] as const).map(([label,rows])=>rows.length>0&&<section className={'tq-findings '+(label.startsWith('코칭')?'tq-hypothesis':'')} key={label}><h5>{label}</h5>{rows.map((f,i)=><p key={i}>{f.text}<small>근거 {f.evidenceIds.length}개 이벤트</small></p>)}</section>)}
      <details className="tq-proof"><summary>근거 시점 · 신뢰도 · 한계</summary><p>유효 표본 {result.confidence.validSamples} · 제외 {result.confidence.excluded} · Uncertain {result.confidence.uncertain} · WITHHELD {result.confidence.withheld} · ID 충돌 {result.confidence.conflictingIds} · 완결 전 창 제외 {result.confidence.rightCensored}</p><p>기준 이벤트 분류 confidence 평균 {result.confidence.meanClassification===null?'—':(result.confidence.meanClassification*100).toFixed(1)+'%'} · 전술 성공 확률이 아닙니다.</p>
        <div className="tq-evidence">{result.evidence.slice(0,allEvidence?undefined:12).map((e,i)=><button key={e.eventId+':'+i} onClick={()=>onSeek(e.availableAt)} title={`${e.eventId}${e.relatedEventId?' → '+e.relatedEventId:''}`}><b>{e.fighterId} {timecode(e.time)}</b>{e.relatedTime!==undefined&&<span> → {e.relatedFighterId} {timecode(e.relatedTime)}</span>}<small>{e.eventId}{e.gap!==undefined?' · 간격 '+e.gap.toFixed(2)+'초':''}</small></button>)}</div>
        {result.evidence.length>12&&<button className="button ghost" onClick={()=>setAllEvidence(v=>!v)}>{allEvidence?'근거 접기':`전체 근거 ${result.evidence.length}개 보기`}</button>}
        {result.limitations.map((text,i)=><p key={i}>{text}</p>)}<p>출처: SIMULATED_SENSOR_FUSION · {result.sourceDataVersion}</p>
      </details>
    </>}
    <footer>{timecode(result.processedUntil)}까지 처리 · {new Date(result.calculatedAt).toLocaleTimeString('ko-KR')} 계산</footer>
  </article>;
}
/** Local selected questions; the sensor worker never waits for a language model. */
export function TacticalQuestions({started,ready,visible,run,time,matchId,onStart,onSeek}:Props){
  const [requests,setRequests]=useState<AnalysisRequest[]>([]),[results,setResults]=useState<AnalysisResult[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const [template,setTemplate]=useState<TemplateId>('sequence'),[fighter,setFighter]=useState<'A'|'B'>('A'),[parameters,setParameters]=useState<Parameters>(defaults),[editing,setEditing]=useState<string|null>(null),[restoredTime,setRestoredTime]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),cache=useRef(new QuestionCache()),archive=useRef<QuestionArchive|null>(null),latest=useRef({run,time,requests,started,loaded}),lastInput=useRef(''),generation=useRef(0);
  latest.current={run,time,requests,started,loaded};
  const completed=!!run&&(time>=run.config.duration-1e-6||started&&restoredTime>=run.config.duration-1e-6),activePhase:RequestPhase=!started?'pre':completed?'post':'live',editRequest=requests.find(r=>r.requestId===editing),phase=editRequest?.phase??activePhase;
  useEffect(()=>{if(activePhase==='pre'&&template==='quality')setTemplate('sequence')},[activePhase]);
  useEffect(()=>{if(!started&&!dialog.current?.open)dialog.current?.showModal();if(started)dialog.current?.close()},[started,matchId]);
  useEffect(()=>{let active=true;generation.current++;setLoaded(false);setRequests([]);setResults([]);setRestoredTime(0);archive.current=null;lastInput.current='';
    void loadQuestions(matchId).then(value=>{if(!active)return;if(value){const accepted=value.requests.map(validateRequest);cache.current=new QuestionCache();for(const result of value.results){const request=accepted.find(r=>r.requestId===result.requestId);if(request)cache.current.restore(value.run,request,value.time,result.resultPhase,result)}setRequests(accepted);setResults(value.results);setRestoredTime(value.time);archive.current=value;setSaved(value.savedAt)}setLoaded(true);setError('')}).catch(e=>{if(active){setLoaded(true);setError('저장 기록을 읽지 못했습니다: '+String(e))}});return()=>{active=false;};
  },[matchId]);
  useEffect(()=>{
    let writing=false,active=true;const version=generation.current;
    const update=async()=>{const value=latest.current;if(!value.loaded||!value.run||writing||version!==generation.current)return;
      const input=JSON.stringify([value.started,value.time,value.requests,value.run.events,value.run.distances]);if(input===lastInput.current)return;
      // Final answers belong to an immutable received-data snapshot. Replaying
      // the scene (including a reload) must not replace it with a newly sampled
      // stream whose floating-point partition boundaries may differ.
      const preserved=archive.current&&(archive.current.time>=archive.current.run.config.duration-1e-6||!value.started&&restoredTime>0&&archive.current.time>value.time)?archive.current:null;
      const analysisRun=preserved?.run??value.run,analysisTime=preserved?.time??value.time;
      writing=true;
      try{
        const computed=value.requests.flatMap(r=>r.phase==='pre'?[cache.current.calculate(analysisRun,r,analysisTime,'live_focus'),cache.current.calculate(analysisRun,r,analysisTime,'final_focus')]:[cache.current.calculate(analysisRun,r,analysisTime,'final_deep')]);
        const next:QuestionArchive={matchId,requests:value.requests,results:computed,run:analysisRun,time:analysisTime,savedAt:new Date().toISOString()};
        if(!active||version!==generation.current)return;
        setResults(computed);await saveQuestions(next);
        if(!active||version!==generation.current)return;
        archive.current=next;lastInput.current=input;setSaved(next.savedAt);setError('');
        if(analysisTime>=analysisRun.config.duration-1e-6)setRestoredTime(analysisTime);
      }catch(e){if(active&&version===generation.current)setError('분석 저장/계산 오류: '+String(e))}finally{writing=false;}
    };
    void update();const timer=setInterval(()=>void update(),1200);return()=>{active=false;clearInterval(timer)};
  },[matchId,loaded,requests,started,completed,restoredTime]);
  const currentTemplate=TEMPLATES.find(t=>t.templateId===template)!,draft={templateId:template,fighterId:fighter,parameters};
  const register=()=>{
    try{
      if(parameters.end!==null&&parameters.end>(run?.config.duration??0)||parameters.start>=(run?.config.duration??Infinity))throw Error('분석 시간은 경기 범위 안에서 선택하세요.');
      const id=editing??crypto.randomUUID(),old=editRequest;
      const request=validateRequest({requestId:id,matchId,phase:old?.phase??activePhase,templateId:template,fighterId:fighter,parameters:{...parameters},createdAt:old?.createdAt??new Date().toISOString()});
      if(requests.some(r=>r.requestId!==id&&r.templateId===template&&r.fighterId===fighter&&JSON.stringify(r.parameters)===JSON.stringify(parameters)&&r.phase===request.phase))throw Error('같은 선수·조건의 질문이 이미 등록되어 있습니다.');
      if(requests.length>=30&&!editing)throw Error('한 경기에 최대 30개 질문을 등록할 수 있습니다.');
      setRequests(rows=>[...rows.filter(r=>r.requestId!==id),request]);setResults(rows=>rows.filter(r=>r.requestId!==id));setEditing(null);setError('');
    }catch(e){setError(String(e))}
  };
  const edit=(r:AnalysisRequest)=>{setEditing(r.requestId);setTemplate(r.templateId);setFighter(r.fighterId);setParameters({...r.parameters});};
  const remove=(id:string)=>{setRequests(rows=>rows.filter(r=>r.requestId!==id));setResults(rows=>rows.filter(r=>r.requestId!==id));if(editing===id)setEditing(null);};
  const form=<div className="tq-builder" data-question-builder>
    <div className="tq-form-grid"><label>경기 단계<select aria-label="질문 경기 단계" value={phase} onChange={()=>{}}><option value={phase}>{phase==='pre'?'경기 전 · 집중 분석':phase==='live'?'경기 중 · 심층 요청':'경기 후 · 심층 요청'}</option></select></label>
      <label>분석 분야<select aria-label="분석 분야" value={template} onChange={e=>{setTemplate(e.target.value as TemplateId);setParameters(defaults())}}>{TEMPLATES.filter(t=>t.phase.includes(phase)).map(t=><option key={t.templateId} value={t.templateId}>{t.title}</option>)}</select></label>
      <label>대상 선수<select aria-label="대상 선수" value={fighter} onChange={e=>setFighter(e.target.value as 'A'|'B')}><option value="A">A · {FIGHTER_NAMES.A}</option><option value="B">B · {FIGHTER_NAMES.B}</option></select></label>
      {template==='quality'?<label>분석 손<select aria-label="분석 손" value={parameters.hand} onChange={e=>setParameters(p=>({...p,hand:e.target.value as Parameters['hand']}))}><option value="all">양손</option><option value="L">왼손</option><option value="R">오른손</option></select></label>:<label>기준 기술<select aria-label="기준 기술" value={parameters.technique} onChange={e=>setParameters(p=>({...p,technique:e.target.value as Parameters['technique']}))}><option value="all">전체 펀치</option>{TECHNIQUES.map(t=><option key={t} value={t}>{LABELS[t]}</option>)}</select></label>}
      {template!=='quality'&&template!=='distance_change'&&<label>후속 공격 관측창<select aria-label="후속 관측창" value={parameters.window} onChange={e=>setParameters(p=>({...p,window:Number(e.target.value)}))}>{[.6,1.2,2].map(t=><option key={t} value={t}>종료 후 {t}초</option>)}</select></label>}
      <label>시작 시각 (초)<input aria-label="분석 시작 시각" type="number" min="0" max={run?.config.duration} step="0.1" value={parameters.start} onChange={e=>setParameters(p=>({...p,start:Number(e.target.value)}))}/></label>
      <label>종료 시각 (초)<input aria-label="분석 종료 시각" type="number" min={parameters.start+.1} max={run?.config.duration} step="0.1" placeholder="전체 경기" value={parameters.end??''} onChange={e=>setParameters(p=>({...p,end:e.target.value===''?null:Number(e.target.value)}))}/></label>
    </div><div className="tq-preview"><span>완성된 질문</span><p>{questionText(draft)}</p><small>{parameters.start}초부터 {parameters.end??'경기 종료'}까지 · {template==='distance_change'?'시작 0.3초 전 / 종료 0.3초 후 공동 거리 비교':template==='quality'?'수신된 후보 기준 · 실제 타격 누락률 아님':`종료 후 ${parameters.window}초 창`}</small></div>
    <div className="tq-value"><b>받을 수 있는 분석</b><p>{[currentTemplate.primaryMetric,...currentTemplate.supportingMetrics,...currentTemplate.contextMetrics,...currentTemplate.opponentInteractionMetrics].join(' · ')}</p><small>전술 해석과 코칭 제안은 관측 근거와 반복 조건이 충족될 때 제공합니다.</small></div>
    <div className="tq-actions"><button type="button" className="button primary" data-register-question disabled={!loaded||!ready} onClick={register}>{editing?'질문 수정 저장':'분석 요청 등록 +'}</button>{editing&&<button className="button ghost" onClick={()=>setEditing(null)}>수정 취소</button>}</div>
  </div>;
  const registered=<div className="tq-registered" aria-label="등록한 분석 요청">{requests.length===0?<p className="tq-empty">확인할 질문을 선택해 등록하세요.</p>:requests.map(r=><div key={r.requestId} data-analysis-request={r.requestId}><span><small>{r.phase==='pre'?'집중 분석':'심층 분석'} · {r.fighterId} 선수</small><b>{questionText(r)}</b></span><button onClick={()=>edit(r)} aria-label={questionText(r)+' 수정'}>수정</button><button onClick={()=>remove(r.requestId)} aria-label={questionText(r)+' 삭제'}>삭제</button></div>)}</div>;
  const exportAnalysis=()=>{if(!archive.current)return;const url=URL.createObjectURL(new Blob([JSON.stringify(archive.current,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=matchId+'-analysis.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const startNew=()=>{archive.current=null;lastInput.current='';setRestoredTime(0);onStart();};
  return <>
    {!started&&<dialog className="tq-prematch" ref={dialog} aria-labelledby="tq-prematch-title" onCancel={e=>e.preventDefault()}><span className="eyebrow">BEFORE THE MATCH / COACHING FOCUS</span><h2 id="tq-prematch-title">이번 경기에서 무엇을 확인할까요?</h2><p>선수와 질문을 선택하면 경기 중 관측과 경기 후 최종 분석을 각각 확인할 수 있습니다.</p>{form}{registered}{error&&<p role="alert" className="tq-error">{error}</p>}<div className="tq-start-actions"><button className="button primary" data-start-match disabled={!ready||!loaded||!!editing} onClick={startNew}>질문을 적용하고 경기 시작 →</button>{restoredTime>0&&<button className="button secondary" data-restore-match disabled={!ready} onClick={()=>onStart(restoredTime)}>저장된 분석 보기 · {timecode(restoredTime)}</button>}</div><small>질문 없이도 시작할 수 있습니다. 분석은 브라우저에서 계산·저장됩니다.</small></dialog>}
    {started&&visible&&<section className="tq-workspace" data-tactical-workspace><header className="tq-heading"><div><span className="eyebrow">FIGHT FREQUENCY / TACTICAL QUESTIONS</span><h2>관측에서 패턴으로, 패턴에서 코칭으로.</h2><p>선택한 선수·조건의 실제 센싱 기록과 전술 해석을 구분합니다.</p></div><span className="tq-state">{completed?'경기 종료 · 최종 분석':'누적 데이터 분석'}</span></header>
      <section className="tq-request-panel"><h3>{editing?'등록 질문 수정':completed?'경기 후 심층 분석 등록':'경기 중 심층 분석 요청'}</h3>{form}{registered}</section>
      {error&&<p role="alert" className="tq-error">{error}</p>}
      <p className="tq-save" role="status" data-tactical-saved={saved}>{saved?'자동 저장 · '+new Date(saved).toLocaleTimeString('ko-KR'):'브라우저 저장 준비 중'} · {requests.length}개 요청 · {ANALYSIS_VERSION}<button onClick={exportAnalysis} className="button ghost">분석과 근거 JSON ↓</button></p>
      {AREAS.map((area,i)=><section key={area.id} className="tq-area" data-answer-area={area.id} aria-labelledby={'tq-'+area.id}><header><span>{String(i+1).padStart(2,'0')}</span><div><h3 id={'tq-'+area.id}>{area.title}</h3><p>{area.subtitle}</p></div></header><div className="tq-answer-grid">{results.filter(r=>r.resultPhase===area.id).map(result=>{const request=requests.find(r=>r.requestId===result.requestId);return request&&<ResultCard key={result.resultId} result={result} request={request} onSeek={onSeek}/>})}{!results.some(r=>r.resultPhase===area.id)&&<p className="tq-empty">{area.id==='final_deep'?'경기 중·후 심층 분석 요청을 등록하면 이곳에 최종 답변이 표시됩니다.':'경기 전 등록한 집중 분석 질문의 답변 영역입니다.'}</p>}</div></section>)}
    </section>}
  </>;
}
