import videoUrl from '../../../assets/sensing/3d_capture.mp4?url';

export function ModelingVideo(){
  return <details className="lv-panel" style={{padding:16,margin:'16px 0'}}>
    <summary style={{cursor:'pointer'}}>영상에서 재구성한 기준 3D 영상 보기 · 3분</summary>
    <p>현재 센싱에 사용하는 두 선수의 관절 모션입니다. 가려진 관절과 깊이·크기는 단안 영상 기반 추정입니다.</p>
    <video controls preload="none" playsInline src={videoUrl} style={{width:'100%',maxHeight:540,background:'#111827'}}/>
  </details>;
}
