import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readSensingInput} from './src/sensing-input.ts';
const appRoot=fileURLToPath(new URL('.',import.meta.url)),project=path.dirname(appRoot);
function api(req:IncomingMessage,res:ServerResponse,next:()=>void){
  if(req.method!=='GET'||!['/api/sensing-motion','/api/motion'].includes((req.url??'').split('?')[0]))return next();
  try{const motion=readSensingInput(project);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(motion))}
  catch(error){res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:String(error)}))}
}
export default defineConfig({root:appRoot,base:'./',publicDir:false,
  server:{host:'127.0.0.1',fs:{allow:[project]}},preview:{host:'127.0.0.1'},
  plugins:[{name:'sensing-input-only',configureServer(s){s.middlewares.use(api)},configurePreviewServer(s){s.middlewares.use(api)}}],
  build:{outDir:path.join(project,'dist'),emptyOutDir:true,chunkSizeWarningLimit:800,
    rollupOptions:{output:{manualChunks(id){if(id.replaceAll('\\','/').includes('/vendor/three/'))return 'three';if(/node_modules[\\/]react/.test(id))return 'react'}}}}});
