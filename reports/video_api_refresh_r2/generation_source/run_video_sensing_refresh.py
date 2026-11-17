"""Execute native video inference -> paid image inference -> gated motion candidate.

Never reads sensing outputs. Rendering and activation remain separate validated
stages so an incomplete candidate cannot silently become the sensing baseline.
"""
from __future__ import annotations
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
def execute(run_id,wait_native=False,execute_api=False,sample_hz=2.,budget_usd=1.):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',run_id):raise ValueError('Invalid run ID')
    report=ROOT/'reports'/run_id;native=ROOT/'output/unified'/run_id
    if not wait_native and (native/'output/reconstruction_report.json').exists():raise ValueError('Existing native run must be preserved; choose a new run ID')
    report.mkdir(parents=True,exist_ok=True);stages=[]
    def save():
        (report/'pipeline_stages.json').write_text(json.dumps({'run_id':run_id,'stages':stages,'sensing_feedback':False},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def command(name,args,timeout):
        row={'stage':name,'command':args,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'RUNNING'};stages.append(row);save()
        try:
            with (report/(name+'.log')).open('w',encoding='utf-8') as stream:
                result=subprocess.run([sys.executable,'-X','utf8',*args],cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT,timeout=timeout)
            row.update(status='PASS' if result.returncode==0 else 'FAILED',exit_code=result.returncode)
            if result.returncode:raise RuntimeError(f'{name} failed; inspect {name}.log')
        except Exception:
            row['status']='FAILED';raise
        finally:
            row['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
        print(json.dumps({'stage':name,'status':row['status']}),flush=True)
    if wait_native:
        end=time.monotonic()+2400
        required=[native/'output/reconstruction_report.json',native/'data/reconstructed_motion.json',native/'data/tracking_2d.json',native/'data/tracking_33.json']
        while not all(p.is_file() for p in required):
            if time.monotonic()>end:raise TimeoutError('Native reconstruction did not complete')
            time.sleep(5)
        info=json.loads(required[0].read_text(encoding='utf-8'))
        if info['frame_count']!=4500 or info.get('inference_cache_reused'):raise ValueError('Fresh full native inference required')
        stages.append({'stage':'native-inference','status':'PASS','source_frames':4500,'cache_reused':False,'execution':'separately launched real native process'});save()
    else:
        command('native-inference',['scripts/track_fighters.py','--video','input/reference_fight.mp4','--seconds','0','--fps','25','--max-width','1280','--model','heavy','--output-root',str(native.relative_to(ROOT)),'--no-preview','--no-3d-video','--skip-legacy-comparison'],2400)
    prefix=str(report.relative_to(ROOT));reconstruction=str(native.relative_to(ROOT))
    command('build-native-candidate',['scripts/build_video_sensing_reference.py','--reconstruction-root',reconstruction,'--output',prefix+'/native_candidate','--report-file',prefix+'/native-reconstruction.json'],180)
    arguments=['scripts/refine_video_api.py','--report-root',prefix,'--reconstruction-root',reconstruction,'--baseline-motion',prefix+'/native_candidate/motion.json.gz','--sample-hz',str(sample_hz),'--budget-usd',str(budget_usd)]
    if execute_api:arguments.append('--execute')
    command('api-inference',arguments,1800)
    summary=json.loads((report/'api_refinement/summary.json').read_text(encoding='utf-8'))
    if summary['status']!='INFERENCE_COMPLETED':raise RuntimeError('Incomplete real image inference; active input retained')
    command('build-refined-candidate',['scripts/apply_video_api_refinement.py','--report-root',prefix,'--reconstruction-root',reconstruction,'--baseline-motion',prefix+'/native_candidate/motion.json.gz','--active-baseline-motion',prefix+'/before/assets/sensing/motion.json.gz'],180)
    quality=json.loads((report/'candidate/quality.json').read_text(encoding='utf-8'))
    if quality['status']!='PASS_BOUNDED_REFINEMENT':raise RuntimeError('Candidate did not pass geometry gates; active input retained')
    print(json.dumps({'status':'CANDIDATE_READY_FOR_RENDERING','run_id':run_id,'api_calls':summary['requests_dispatched_total'],'changed_frames':quality['difference_from_active']['changed_frames']}),flush=True)
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-id',required=True);parser.add_argument('--wait-native',action='store_true');parser.add_argument('--execute-api',action='store_true');parser.add_argument('--sample-hz',type=float,default=2.);parser.add_argument('--budget-usd',type=float,default=1.);args=parser.parse_args();execute(args.run_id,args.wait_native,args.execute_api,args.sample_hz,args.budget_usd)
