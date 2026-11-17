"""Bounded, resumable source-image inference. No sensing result enters this stage.

Images span the entire video at 1 Hz; native local inference remains 25 FPS.
External 2D estimates are proposals, never measured depth or verified identity.
"""
from __future__ import annotations
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime
import gzip
import hashlib
import json
from pathlib import Path
import sys
import cv2
import numpy as np
from ff_ai_provider import PleumTransport, ProviderError, wire_schema

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'reports/autonomous_execution/api_refinement'
JOINTS = ['head','left_shoulder','left_elbow','left_wrist','right_shoulder','right_elbow','right_wrist','left_ankle','right_ankle']
def sha(data): return hashlib.sha256(data).hexdigest()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n', encoding='utf-8')
def read(path): return json.loads(path.read_text(encoding='utf-8'))

def validate_response(response, model, indices):
    choice=response['choices'][0]
    if response.get('model')!=model or choice.get('finish_reason')!='stop': raise ValueError('Wrong model or truncated output')
    value=json.loads(choice['message']['content'])
    if [v['frame'] for v in value['frames']]!=indices: raise ValueError('Frame alignment mismatch')
    for frame in value['frames']:
        slots=[p['slot'] for p in frame['people']]
        # An intro/cut with no visible athlete is a valid abstention. Never add
        # fictitious A/B points just to satisfy the requested output layout.
        if len(slots)!=len(set(slots)) or any(s not in ['A','B'] for s in slots): raise ValueError('Actor slots mismatch')
        for person in frame['people']:
            if not 0<=person['identity_confidence']<=1: raise ValueError('Invalid identity confidence')
            if sorted(p['joint'] for p in person['points'])!=sorted(JOINTS): raise ValueError('Joint list mismatch')
            for p in person['points']:
                if not 0<=p['confidence']<=1: raise ValueError('Invalid joint confidence')
                if p['visible'] and (p['x'] is None or p['y'] is None or not 0<=p['x']<=1 or not 0<=p['y']<=1): raise ValueError('Invalid visible point')
    return value

def run(execute=False,report_root=None,reconstruction_root='output/unified/video_refresh_20261117',baseline_motion='assets/sensing/motion.json.gz',sample_hz=1.,budget_usd=.50):
    global OUT
    if report_root is not None:OUT=ROOT/report_root/'api_refinement'
    OUT.mkdir(parents=True, exist_ok=True)
    video=ROOT/'input/reference_fight.mp4'
    motion_file=ROOT/baseline_motion
    packed=motion_file.read_bytes(); motion=json.loads(gzip.decompress(packed))
    source_sha=sha(video.read_bytes())
    if motion['source_sha256']!=source_sha: raise ValueError('Source binding mismatch')
    reconstruction=ROOT/reconstruction_root
    tracking=read(reconstruction/'data/tracking_2d.json')
    native=read(reconstruction/'data/reconstructed_motion.json')
    transport=PleumTransport(timeout=120, retries=0)
    entry=transport.entry(transport.model,'chat.generate')
    if 'image' not in entry.get('input_modalities',[]): raise ValueError('Image support required')
    # A conservative token reservation, not a promise about provider billing.
    # Existing credits only; this script cannot purchase or top up credits.
    if not 0<sample_hz<=25 or not 0<budget_usd<=1:raise ValueError('Sampling/budget outside bounded execution limits')
    frames=sorted(set(round(k*motion['fps']/sample_hz) for k in range(int(len(motion['frames'])/motion['fps']*sample_hz))))
    batches=[frames[k:k+6] for k in range(0,len(frames),6)]
    pricing=entry['pricing']; reserve_usd=len(batches)*(6*12000*float(pricing['prompt'])+6000*float(pricing['completion']))
    if reserve_usd>budget_usd: raise ValueError('Conservative reservation exceeds execution cap')
    credits=transport.request('/credits',timeout=25)[0]
    if credits['balance_usd']<reserve_usd: raise ValueError('Insufficient existing credits')
    write(OUT/'plan.json',{'source_sha256':source_sha,'baseline_motion_sha256':sha(packed),'model':transport.model,'base_url':transport.base,
        'source_frames':len(motion['frames']),'source_fps':motion['fps'],'api_frame_indices':frames,'api_sampling_hz':sample_hz,'batch_count':len(batches),
        'maximum_new_calls':len(batches),'retry_policy':'NO_RETRY_AFTER_DISPATCH','conservative_reserved_usd':reserve_usd,'execution_cap_usd':budget_usd,
        'pricing':pricing,'catalog':entry,'balance_usd_before':credits['balance_usd'],'sensing_feedback':False})
    schema={'type':'object','properties':{'frames':{'type':'array','items':{'type':'object','properties':{
        'frame':{'type':'integer'},'people':{'type':'array','items':{'type':'object','properties':{
            'slot':{'type':'string','enum':['A','B']},'identity_confidence':{'type':'number'},
            'points':{'type':'array','items':{'type':'object','properties':{'joint':{'type':'string','enum':JOINTS},
                'x':{'type':['number','null']},'y':{'type':['number','null']},'confidence':{'type':'number'},'visible':{'type':'boolean'}}}}}}}}}}}}
    capture=cv2.VideoCapture(str(video)); prepared=[]
    try:
        for number,batch in enumerate(batches):
            content=[{'type':'text','text':
                'Inspect actual MMA video images, in time order. Return image-plane joint centers, normalized x/y in [0,1]. '
                'A/B labels mark existing tracker shoulder centers only, and may be uncertain. Preserve anatomical left/right. '
                'Use all nine specified joints per slot per image. Occluded/invisible: x/y=null, confidence=0, visible=false. '
                'Do not invent hidden positions, depth, hit/contact or actions. Identity confidence must reflect actual ambiguity. '
                'Points are visual estimates, not measured 3D. Return exactly the supplied frame indices.'}]
            images=[]
            for k in batch:
                capture.set(cv2.CAP_PROP_POS_FRAMES,k); ok,img=capture.read()
                if not ok: raise ValueError(f'Source frame decode failed: {k}')
                img=cv2.resize(img,(768,432))
                for fi,color in [(0,(80,140,255)),(1,(255,210,70))]:
                    row=np.asarray(tracking['frames'][k][fi]); indices=[4,7]
                    if min(row[indices,2])>=.6:
                        p=np.mean(row[indices,:2],axis=0)*[768,432]
                        cv2.putText(img,'AB'[fi],(int(p[0]),max(20,int(p[1])-20)),cv2.FONT_HERSHEY_SIMPLEX,.7,color,2)
                ok,data=cv2.imencode('.jpg',img,[cv2.IMWRITE_JPEG_QUALITY,85])
                if not ok: raise ValueError('JPEG encode failed')
                data=data.tobytes(); images.append({'frame':k,'sha256':sha(data),'bytes':len(data)})
                content.extend([{'type':'text','text':f'frame={k}, source_time_s={k/motion["fps"]:.2f}'},
                    {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(data).decode(),'detail':'high'}}])
            payload={'model':transport.model,'stream':False,'reasoning_effort':transport.effort,'max_tokens':6000,'temperature':0,
                'messages':[{'role':'user','content':content}],
                'response_format':{'type':'json_schema','json_schema':{'name':'VideoLandmarks','strict':True,'schema':wire_schema(schema)}}}
            binding={'source_sha256':source_sha,'frames':batch,'images':images,'request_sha256':sha(json.dumps(payload,sort_keys=True).encode())}
            prepared.append((number,payload,binding))
    finally: capture.release()

    def dispatch(task):
        number,payload,binding=task
        receipt=OUT/f'batch-{number:02d}.json'
        if receipt.exists():
            prior=read(receipt)
            if prior['binding']!=binding: raise ValueError('Existing inference binding changed')
            raw_path=OUT/f'response-{number:02d}.json'
            if prior['status']=='FAILED_KEEP_BASELINE' and raw_path.exists():
                response=read(raw_path)
                try:
                    value=validate_response(response,transport.model,binding['frames'])
                    prior.update(status='VALIDATED_VISUAL_ESTIMATES',prior_validation_error=prior.get('error'),
                        request_id=response.get('id'),usage=response.get('usage'),response_sha256=sha(raw_path.read_bytes()),result=value,
                        offline_revalidation=True)
                    write(receipt,prior)
                except (ValueError,KeyError,TypeError): pass
            return prior|{'cache_hit_this_run':True,'remote_calls_this_run':0}
        result={'binding':binding,'status':'RESERVED_NO_AUTOMATIC_RETRY','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cache_hit_this_run':False,'remote_calls_this_run':0}
        if not execute: return result|{'status':'NOT_EXECUTED'}
        # Atomic reservation prevents accidental duplicate billing after interruption.
        with receipt.open('x',encoding='utf-8') as f: json.dump(result,f)
        try:
            worker=PleumTransport(timeout=120,retries=0)
            result['remote_calls_this_run']=1
            response,audit=worker.request('/chat/completions',payload)
            write(OUT/f'response-{number:02d}.json',response)
            result.update(request_id=response.get('id'),usage=response.get('usage'),audit=audit,response_sha256=sha((OUT/f'response-{number:02d}.json').read_bytes()))
            value=validate_response(response,worker.model,binding['frames'])
            result.update(status='VALIDATED_VISUAL_ESTIMATES',request_id=response.get('id'),usage=response.get('usage'),audit=audit,
                response_sha256=sha((OUT/f'response-{number:02d}.json').read_bytes()),result=value)
        except (ProviderError,ValueError,KeyError,TypeError) as error:
            result.update(status='FAILED_KEEP_BASELINE',error_kind=getattr(error,'kind',type(error).__name__),error=str(error))
        result['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat(); write(receipt,result)
        return result
    results=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for future in as_completed([pool.submit(dispatch,t) for t in prepared]):
            result=future.result(); results.append(result)
            print(json.dumps({'frames':result['binding']['frames'],'status':result['status']},ensure_ascii=True),flush=True)
    successful=[r for r in results if r['status']=='VALIDATED_VISUAL_ESTIMATES']
    usage={k:sum((r.get('usage') or {}).get(k,0) for r in results) for k in ['prompt_tokens','completion_tokens','total_tokens']}
    summary={'status':'INFERENCE_COMPLETED' if len(successful)==len(batches) else 'PARTIAL_INFERENCE','requests_dispatched_total':len(list(OUT.glob('batch-*.json'))),
        'successful':len(successful),'validated_frames':sum(len(r['result']['frames']) for r in successful),'usage':usage,
        'new_api_calls_this_run':sum(r.get('remote_calls_this_run',0) for r in results),'cache_hits_this_run':sum(bool(r.get('cache_hit_this_run')) for r in results),
        'computed_token_cost_usd':usage['prompt_tokens']*float(pricing['prompt'])+usage['completion_tokens']*float(pricing['completion']),
        'source_sha256':source_sha,'baseline_motion_sha256':sha(packed),'model':transport.model,'api_sampling_hz':sample_hz,'reconstruction_root':str(reconstruction_root),'sparse_api_not_native_frame_inference':True,
        'true_3d_accuracy_proven':False,'sensing_feedback':False}
    write(OUT/'summary.json',summary);print(json.dumps(summary),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--execute',action='store_true');p.add_argument('--report-root');p.add_argument('--reconstruction-root',default='output/unified/video_refresh_20261117');p.add_argument('--baseline-motion',default='assets/sensing/motion.json.gz');p.add_argument('--sample-hz',type=float,default=1.);p.add_argument('--budget-usd',type=float,default=.5);a=p.parse_args();run(a.execute,a.report_root,a.reconstruction_root,a.baseline_motion,a.sample_hz,a.budget_usd)
