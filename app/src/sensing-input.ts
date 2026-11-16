import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validateMotion} from '../../motion/sampling.ts';
import {videoMotionSource} from '../../sensing/adapters.ts';

/** Completed reconstruction -> read-only sensing input. No video or inference dependency. */
export function readSensingInput(projectRoot:string){
  const folder=path.join(projectRoot,'assets/sensing');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  if(manifest.schema!=='ff_sensing_input_v1'||manifest.metric_valid!==false||manifest.sensing_feedback!==false)
    throw Error('Invalid sensing input manifest');
  if(manifest.text_hash_normalization!=='CRLF_TO_LF_ONLY')throw Error('Unknown sensing integrity policy');
  for(const [name,sha] of Object.entries(manifest.files)){
    const file=path.resolve(projectRoot,name);
    if(!file.startsWith(path.resolve(projectRoot)+path.sep))throw Error('Invalid sensing asset path');
    const bytes=fs.readFileSync(file),content=/\.(json|ts|obj)$/.test(name)?bytes.toString('utf8').replace(/\r\n/g,'\n'):bytes;
    if(createHash('sha256').update(content).digest('hex')!==sha)
      throw Error('Sensing asset integrity mismatch: '+name);
  }
  const motion=JSON.parse(gunzipSync(fs.readFileSync(path.join(folder,'motion.json.gz'))).toString('utf8'));
  validateMotion(motion);videoMotionSource(motion);
  if(motion.source_sha256!==manifest.source_sha256||motion.frames.length!==manifest.frame_count||motion.fps!==manifest.fps)
    throw Error('Sensing source/time binding mismatch');
  return motion;
}
