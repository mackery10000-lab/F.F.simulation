import {StrictMode,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SensingLab} from './src/sensing/SensingLab.tsx';
import './base.css';
if(!location.hash)history.replaceState(null,'','#/sensing');
const readEntry=()=>location.hash.startsWith('#/coaching')?'coaching':'sensing';
function Workspace(){
  const [entry,setEntry]=useState(readEntry);
  useEffect(()=>{const update=()=>setEntry(readEntry());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update)},[]);
  return <main className="sensing-workspace" aria-label="실시간 센서 관제"><SensingLab key={entry}/></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Workspace/></StrictMode>);
