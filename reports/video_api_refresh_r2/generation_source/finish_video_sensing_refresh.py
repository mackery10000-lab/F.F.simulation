"""Render and activate a gated video run, then verify both sensing runtimes."""
from pathlib import Path
import argparse
import datetime
import json
import re
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
def finish(run_id,resume_after=None):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',run_id):raise ValueError('Invalid run ID')
    report=ROOT/'reports'/run_id;events=[];services=[];streams=[]
    skip_until=resume_after
    if resume_after:
        events=json.loads((report/'finish_stages.json').read_text(encoding='utf-8'))['stages']
        if not any(e['stage']==resume_after and e['status']=='PASS' for e in events):raise ValueError('Resume checkpoint has no successful execution')
        active=(ROOT/'assets/sensing/motion.json.gz').read_bytes();candidate=(report/'candidate/motion.json.gz').read_bytes()
        if active!=candidate:raise ValueError('Cannot resume verification for a different active input')
    def save():
        (report/'finish_stages.json').write_text(json.dumps({'run_id':run_id,'stages':events},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def command(name,args,timeout=180):
        nonlocal skip_until
        if skip_until is not None:
            if name==skip_until:skip_until=None
            return
        row={'stage':name,'command':args,'status':'RUNNING','started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()};events.append(row);save()
        try:
            with (report/(name+'.log')).open('w',encoding='utf-8') as stream:
                result=subprocess.run(args,cwd=ROOT,stdout=stream,stderr=subprocess.STDOUT,timeout=timeout)
            row.update(status='PASS' if result.returncode==0 else 'FAILED',exit_code=result.returncode)
            if result.returncode:raise RuntimeError(f'{name} failed; inspect {name}.log')
        finally:row['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
        print(json.dumps({'stage':name,'status':row['status']}),flush=True)
    def service(name,directory,args,port):
        stream=(report/(name+'.log')).open('w',encoding='utf-8');streams.append(stream)
        process=subprocess.Popen(args,cwd=directory,stdout=stream,stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));services.append(process)
        end=time.monotonic()+30
        while time.monotonic()<end:
            if process.poll() is not None:raise RuntimeError(name+' exited before readiness')
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=2) as response:
                    if response.status==200:return
            except OSError:pass
            time.sleep(.3)
        raise TimeoutError(name+' readiness timeout')
    end=time.monotonic()+4200
    while not (report/'candidate/quality.json').is_file():
        if time.monotonic()>end:raise TimeoutError('Candidate did not finish')
        time.sleep(5)
    quality=json.loads((report/'candidate/quality.json').read_text(encoding='utf-8'))
    if quality['status']!='PASS_BOUNDED_REFINEMENT':raise ValueError('Unaccepted candidate; nothing activated')
    py=[sys.executable,'-X','utf8'];prefix=str(report.relative_to(ROOT));node=['node']
    try:
        service('source-server',ROOT/'analysis-platform',node+[str(ROOT/'analysis-platform/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5213','--strictPort'],5213)
        command('render',node+['tools/render_reference_video.mjs','http://127.0.0.1:5213','--run-root',prefix],900)
        blender=ROOT/'tools/blender/blender-5.2.4-windows-x64/blender.exe'
        command('blender',[str(blender),'--background','--python','scripts/export_mma_rig_blender.py','--','--run-root',prefix],600)
        command('publish',py+['scripts/publish_api_refinement.py','--report-root',prefix])
        command('finalize',py+['tools/finalize_mma_assets.py'])
        command('rig-check',node+['tools/verify_mma_rig.mjs','--report-root',prefix])
        command('sync',py+['tools/sync_mma_sensing.py'])
        command('source-full',node+['--experimental-strip-types','tools/mma_replay.ts','--out',str(report/'source-full.json')])
        command('mirror-full',node+['--experimental-strip-types','github.f.f/tools/mma_replay.ts','--out',str(report/'mirror-full.json')])
        command('sensing-tests',node+['--experimental-strip-types','--test','sensing/tests/*.test.ts'])
        command('python-tests',py+['-m','pytest','tests','coaching/tests','-q','--disable-warnings','--maxfail=5'],300)
        command('platform-tests',node+['--experimental-strip-types','--test','analysis-platform/tests/*.test.ts'])
        npm_cli=Path(subprocess.check_output(['where.exe','npm.cmd'],text=True).splitlines()[0]).parent/'node_modules/npm/bin/npm-cli.js'
        command('source-build',node+[str(npm_cli),'--prefix','analysis-platform','run','build'])
        command('mirror-tests',node+[str(npm_cli),'--prefix','github.f.f','test'])
        command('mirror-build',node+[str(npm_cli),'--prefix','github.f.f','run','build'])
        command('package-check',py+['tools/verify_sensing_package.py','--mma-upgrade','--check-only'])
        command('browser-source',node+['tools/verify_autonomous_browser.mjs','http://127.0.0.1:5213','source','--report-root',prefix])
        service('mirror-server',ROOT/'github.f.f',node+[str(ROOT/'github.f.f/node_modules/vite/bin/vite.js'),'preview','--config','app/vite.config.ts','--host','127.0.0.1','--port','5214','--strictPort'],5214)
        command('browser-mirror',node+['tools/verify_autonomous_browser.mjs','http://127.0.0.1:5214','mirror','--report-root',prefix])
        source=json.loads((report/'source-full.json').read_text());mirror=json.loads((report/'mirror-full.json').read_text())
        for key in ['input_asset_sha256','measurement_digest','measurements','events','per_sensor']:
            if source[key]!=mirror[key]:raise ValueError('Runtime mismatch: '+key)
        result={'status':'APPLIED_AND_RUNTIME_VERIFIED','run_id':run_id,'asset_sha256':source['input_asset_sha256'],
            'measurements':source['measurements'],'source_mirror_digest_matches':True,'api_calls_in_sensing':source['api_calls_in_sensing']+mirror['api_calls_in_sensing'],
            'substantial_accuracy_improvement_proven':False,'remote_push':False}
        (report/'verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result),flush=True)
    finally:
        for process in reversed(services):
            if process.poll() is None:process.terminate();process.wait(timeout=15)
        for stream in streams:stream.close()
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-id',required=True);parser.add_argument('--resume-after');args=parser.parse_args();finish(args.run_id,args.resume_after)
