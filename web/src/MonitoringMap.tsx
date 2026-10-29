import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import template from './vworld-frame.html?raw';
import {sample,parseConfiguration,sector,type MapConfiguration,type Position} from './map-model';
import {TerrainCalibration,type PreviewGround,type PreviewRequest} from './TerrainCalibration';
import {validMapControlPoint,type ManualOrientation,type MapControlPoint} from './calibration-model';
import {parseMapBundle,layerLines,MAX_MAP_FILE_BYTES,type MapLayer} from './map-layers';
import {publishedMap} from './default-map';
import {CoverageControls,readSavedCoverage} from './CoverageControls';
import {buildCoverageShapes} from './coverage-model';
import {LocationLookup} from './LocationLookup';
import {validLocation,type SelectedLocation} from './location-model';
import {useTerrainVisibility} from './useTerrainVisibility';
import {TerrainVisibilityControls} from './TerrainVisibilityControls';
import {SmokeAlerts} from './SmokeAlerts';
import {LiveCapture,type CapturedFrame} from './LiveCapture';
import {NativePtzTracking} from './NativePtzTracking';
import {InstallationPositionEditor} from './InstallationPositionEditor';
import {useAutomaticMonitoring,automaticCoverage,automaticPose} from './automatic-monitoring';
import type {CoverageShape} from './coverage-model';
import {AutomaticMonitoringPanel} from './AutomaticMonitoringPanel';
import {monitorFetch} from './monitor-server';
import type {DevicePtzObservation} from './DevicePtzStatus';
import type {NativeProfile} from './native-profile';
import {VisualTracking,type LiveVisualView} from './VisualTracking';
import {DiagnosticReview} from './DiagnosticReview';
import {matchesDiagnosticCamera,diagnosticBounds,type DiagnosticReview as Review} from './diagnostic-review';
import {buildAlertMarkers,type AlertBinding,type SmokeAlertDocument} from './smoke-alert-model';
import './MapWorkspace.css';

type MapSnapshot={revision:string;configuration:MapConfiguration};
async function requestMap(options?:RequestInit):Promise<MapSnapshot>{
 const response=await monitorFetch('/api/map-configuration',options);
 const body=await response.json().catch(()=>null);
 if(!response.ok)throw new Error(body?.error??'지도 설정 요청 실패');
 if(typeof body?.revision!=='string')throw new Error('지도 설정 응답을 확인하세요.');
 return {revision:body.revision,configuration:parseConfiguration(JSON.stringify(body.configuration))};
}
export function MonitoringMap({active=true,standalone=false,desktopDemo=false,serverMode=false,canManage=true}:{active?:boolean;standalone?:boolean;desktopDemo?:boolean;serverMode?:boolean;canManage?:boolean}){
 const initialMap=standalone&&publishedMap?publishedMap:{...sample,layers:[]};
 const [configuration,setConfiguration]=useState<MapConfiguration>({schemaVersion:1,crs:'EPSG:4326',positions:initialMap.positions}),[selected,setSelected]=useState(initialMap.positions[0]?.id??'');
 const [revision,setRevision]=useState<string|null>(null),[dirty,setDirty]=useState(false),[writeKey,setWriteKey]=useState(''),[saving,setSaving]=useState(false),[storageStatus,setStorageStatus]=useState('중앙 지도 설정을 읽는 중…');
 const [deploymentKey,setDeploymentKey]=useState(import.meta.env.VITE_VWORLD_API_KEY?.trim()??''),[settingsLoaded,setSettingsLoaded]=useState(standalone),[tools,setTools]=useState(serverMode?'auto':'cameras');
 const autoConnected=useRef(false);
 const fittedFrame=useRef<string|null>(null);
 const [layers,setLayers]=useState<MapLayer[]>(initialMap.layers),[visibleLayers,setVisibleLayers]=useState<string[]>(initialMap.layers.map(l=>l.id)),[layerRevision,setLayerRevision]=useState(initialMap.layers.length?'published-bukhansan':'none'),[layerStatus,setLayerStatus]=useState<Record<string,string>>({});
 const layerRevisionRef=useRef(layerRevision);layerRevisionRef.current=layerRevision;
 const [name,setName]=useState(''),[latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[uuid,setUuid]=useState('');
 const [key,setKey]=useState(''),[frame,setFrame]=useState<{html:string;session:string}|null>(null),[ready,setReady]=useState(false);
 const [appliedKey,setAppliedKey]=useState(''),[locationPoint,setLocationPoint]=useState<SelectedLocation|null>(null),[locationPicking,setLocationPicking]=useState(false),[locationError,setLocationError]=useState('');
 const pickingRef=useRef(locationPicking);pickingRef.current=locationPicking;
 const [geoPicking,setGeoPicking]=useState<string|null>(null),[geoPickError,setGeoPickError]=useState('');
 const geoPending=useRef<{id:string;cameraId:string;resolve:(point:MapControlPoint)=>void;reject:(error:Error)=>void;cleanup:()=>void}|null>(null);
 const selectedRef=useRef(selected);selectedRef.current=selected;
 const [status,setStatus]=useState('좌표 배치도 · VWorld 미연결'),[error,setError]=useState('');
 const [simulation,setSimulation]=useState(false),[heading,setHeading]=useState(0),[fov,setFov]=useState(60),[range,setRange]=useState(1000),[showEstimate,setShowEstimate]=useState(true);
 const [savedCoverage]=useState(readSavedCoverage),[coveragePlans,setCoveragePlans]=useState(savedCoverage.plans),[coverageStorageStatus,setCoverageStorageStatus]=useState(savedCoverage.status),[coverageHidden,setCoverageHidden]=useState(false),[coverageSelectedOnly,setCoverageSelectedOnly]=useState(false),[coverageRenderError,setCoverageRenderError]=useState('');
 const coverageRequest=useRef('');
 const visibilityRequest=useRef('');
 const alarmRequest=useRef('');
 const [alertDocument,setAlertDocument]=useState<SmokeAlertDocument|null>(null),[alertBindings,setAlertBindings]=useState<AlertBinding[]>([]),[alertsHidden,setAlertsHidden]=useState(false),[alarmRenderError,setAlarmRenderError]=useState('');
 const [aspect,setAspect]=useState<number|null>(null),[previewEpoch,setPreviewEpoch]=useState(0),[calibrating,setCalibrating]=useState(false);
 const [captureFrame,setCaptureFrame]=useState<CapturedFrame|null>(null),[liveView,setLiveView]=useState<LiveVisualView|null>(null);
 const [nativePtz,setNativePtz]=useState<DevicePtzObservation|null>(null),[trackingMode,setTrackingMode]=useState('visual'),[trialView,setTrialView]=useState<PreviewRequest|null>(null);
 const [diagnostic,setDiagnostic]=useState<Review|null>(null),[diagnosticError,setDiagnosticError]=useState('');
 const diagnosticRequest=useRef('');
 const liveViewOwner=useRef(false),liveViewTicket=useRef(0);
 const edits=useRef(0),iframe=useRef<HTMLIFrameElement>(null),pending=useRef(new Map<string,{resolve:(ground:PreviewGround)=>void;reject:(error:Error)=>void;timer:number}>());
 const positions=configuration.positions,current=positions.find(p=>p.id===selected);
 const automatic=useAutomaticMonitoring(serverMode&&active);
 // Image counters and receive timestamps must not rebuild unchanged map geometry.
 const runtimeCoverageKey=JSON.stringify(automaticCoverage(positions,automatic.state,automatic.now));
 const runtimeCoverage=useMemo<CoverageShape[]>(()=>JSON.parse(runtimeCoverageKey),[runtimeCoverageKey]);
 const [automaticView,setAutomaticView]=useState(false),[automaticViewError,setAutomaticViewError]=useState('');
 const automaticViewRequest=useRef(''),automaticViewSent=useRef('');
 const currentFeed=automatic.state?.cameras.find(c=>c.cameraId===selected),currentAutomaticPose=current?automaticPose(current,currentFeed,automatic.now):null;
 const currentObservation=currentFeed?.feed.observation;
 const automaticAspect=currentObservation?.width&&currentObservation?.height?currentObservation.width/currentObservation.height:16/9;
 const automaticViewData=current&&currentAutomaticPose?{position:current,pose:currentAutomaticPose,groundElevationM:current.nativeTracking!.groundElevationM,groundElevationSource:'operator',aspectRatio:automaticAspect,sourceSession:currentObservation?.sessionId}:null;
 const automaticViewKey=JSON.stringify(automaticViewData);
 const diagnosticAspect=diagnostic&&matchesDiagnosticCamera(diagnostic,current)?diagnostic.reference.width/diagnostic.reference.height:null;
 const previousDiagnosticAspect=useRef(diagnosticAspect);
 const diagnosticPoints=useMemo(()=>active&&tools==='cameras'&&diagnostic&&matchesDiagnosticCamera(diagnostic,current)?diagnostic.points:[],[active,tools,diagnostic,current]);
 const positionsRef=useRef(positions);positionsRef.current=positions;
 const estimate=current?.orientation?.status==='estimate'?current.orientation:null;
 const coverageShapes=useMemo(()=>calibrating||coverageHidden?[]:serverMode?runtimeCoverage.filter(p=>!coverageSelectedOnly||p.cameraId===selected):buildCoverageShapes(positions,coveragePlans,coverageSelectedOnly?selected:null),[positions,coveragePlans,coverageSelectedOnly,selected,coverageHidden,calibrating,serverMode,runtimeCoverage]);
 const visibility=useTerrainVisibility({positions,current,plans:coveragePlans,ready:ready&&!serverMode,session:frame?.session??null,post});
 const visibilityReceiver=useRef(visibility.receive);visibilityReceiver.current=visibility.receive;
 const displayedVisibility=useMemo(()=>!ready||calibrating?[]:visibility.results.filter(v=>coverageShapes.some(s=>s.cameraId===v.cameraId)),[visibility.results,coverageShapes,ready,calibrating]);
 const computedCoverageShapes=useMemo(()=>coverageShapes.map(s=>({...s,visibilityComputed:displayedVisibility.some(v=>v.cameraId===s.cameraId)})),[coverageShapes,displayedVisibility]);
 const alertMarkers=useMemo(()=>alertsHidden||calibrating?[]:buildAlertMarkers(alertDocument,alertBindings,positions),[alertDocument,alertBindings,positions,alertsHidden,calibrating]);
 const polygon=calibrating||coverageShapes.some(s=>s.cameraId===selected)?null:simulation&&current?sector(current,heading,fov,range):!serverMode&&showEstimate&&estimate&&current?sector(current,estimate.headingDeg,estimate.horizontalFovDeg,range):null;
 const displayedLines=layers.filter(l=>visibleLayers.includes(l.id)).map(l=>({layer:l,lines:layerLines(l)}));
 const extentPoints=[...positions.map(p=>[p.lon,p.lat]),...displayedLines.flatMap(l=>l.lines.flat()),...coverageShapes.flatMap(s=>s.coordinates),...diagnosticPoints.map(p=>[p.lon,p.lat])];
 const extent=extentPoints.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[180,90,-180,-90]);
 const xmin=(extentPoints.length?extent[0]:126.96)-.005,xmax=(extentPoints.length?extent[2]:126.99)+.005;
 const ymin=(extentPoints.length?extent[1]:37.64)-.005,ymax=(extentPoints.length?extent[3]:37.68)+.005;
 const longitudeScale=Math.cos((ymin+ymax)/2*Math.PI/180),diagramScale=Math.min(720/((xmax-xmin)*longitudeScale),400/(ymax-ymin));
 const xy=(lon:number,lat:number)=>[400+(lon-(xmin+xmax)/2)*longitudeScale*diagramScale,240-(lat-(ymin+ymax)/2)*diagramScale];
 async function loadCentral(){
  const ticket=edits.current;setSaving(true);setError('');
  try{
   const next=await requestMap();if(ticket!==edits.current){setStorageStatus('현재 입력을 유지했습니다. 중앙 설정을 다시 불러온 뒤 저장하세요.');return;}setRevision(next.revision);
   const document=next.revision==='none'?sample:next.configuration;
   setConfiguration(document);setSelected(document.positions[0]?.id??'');setDirty(false);
   setStorageStatus(next.revision==='none'?'중앙 저장된 지도 설정 없음 · 초기 시험 좌표 표시':'중앙 지도 설정 불러옴');exitPreview();
  }catch(e){setRevision(null);setStorageStatus('중앙 저장 사용 불가 · JSON 파일로 보관할 수 있습니다.');setError((e as Error).message);}
  finally{setSaving(false);}
 }
 useEffect(()=>{if(!standalone)void loadCentral();else setStorageStatus('북한산 기본 지도 표시 · 편집한 설정은 JSON으로 보관하세요.');},[]);
 useEffect(()=>{if(standalone||!active||settingsLoaded)return;let cancelled=false;fetch('/api/map-client-settings').then(r=>r.ok?r.json():null).then(s=>{if(!cancelled&&typeof s?.vworldApiKey==='string')setDeploymentKey(s.vworldApiKey.trim());}).catch(()=>{}).finally(()=>{if(!cancelled)setSettingsLoaded(true);});return()=>{cancelled=true;};},[active,standalone,settingsLoaded]);
 useEffect(()=>{if(active&&deploymentKey&&!autoConnected.current){autoConnected.current=true;connect(deploymentKey);}},[active,deploymentKey]);
 function cancelPending(message:string){pending.current.forEach(p=>{clearTimeout(p.timer);p.reject(new Error(message));});pending.current.clear();}
 function post(type:string,data:object={}){if(frame)iframe.current?.contentWindow?.postMessage({scope:'vworld-prototype',session:frame.session,type,...data},location.origin);}
 function cancelGeoPick(message:string){const pending=geoPending.current;if(!pending)return;geoPending.current=null;pending.cleanup();pending.reject(new Error(message));setGeoPicking(null);setGeoPickError('');post('geo-point-mode',{enabled:false});}
 useEffect(()=>{if(!active||tools!=='cameras')cancelGeoPick('지도 도구가 변경돼 기준점 지정을 취소했습니다.');},[active,tools]);
 function exitPreview(){setAutomaticView(false);automaticViewRequest.current='';automaticViewSent.current='';cancelGeoPick('지도 시점이 변경돼 기준점 지정을 취소했습니다.');cancelPending('가상 시점 요청이 취소됐습니다.');setPreviewEpoch(v=>v+1);setCalibrating(false);post('end-calibration');post('draw',{positions,selected,sector:null,flyTo:true});}
 function pickGeoPoint(signal:AbortSignal):Promise<MapControlPoint>{
  if(!frame||!ready||!active||signal.aborted)return Promise.reject(new Error('VWorld 지도에 연결한 뒤 기준점을 지정하세요.'));
  exitPreview();setLocationPicking(false);pickingRef.current=false;setTools('cameras');
  return new Promise((resolve,reject)=>{
   const id=crypto.randomUUID(),abort=()=>cancelGeoPick('기준점 지정을 취소했습니다.');
   signal.addEventListener('abort',abort,{once:true});geoPending.current={id,cameraId:selectedRef.current,resolve,reject,cleanup:()=>signal.removeEventListener('abort',abort)};
   setGeoPicking(id);setGeoPickError('');post('geo-point-mode',{enabled:true,requestId:id});
  });
 }
 function selectPosition(id:string){exitPreview();setSelected(id);post('draw',{positions:positionsRef.current,selected:id,sector:null,flyTo:true});}
 useEffect(()=>{
  if(!frame)return;let completed=false;
  const timer=window.setTimeout(()=>{if(!completed){setStatus('연결 시간 초과');setError('30초 안에 뷰어가 준비되지 않았습니다. 키 등록 주소와 SDK·지형 서버 접속을 확인하세요.');}},30000);
  const listener=(e:MessageEvent)=>{
   if(e.source!==iframe.current?.contentWindow||e.origin!==location.origin||e.data?.scope!=='vworld-prototype'||e.data.session!==frame.session)return;
   if(e.data.type==='automatic-view-error'&&e.data.requestId===automaticViewRequest.current){setAutomaticView(false);automaticViewRequest.current='';automaticViewSent.current='';setAutomaticViewError(String(e.data.message));post('end-calibration');}
   if(e.data.type==='select-camera'&&positionsRef.current.some(p=>p.id===e.data.id))selectPosition(e.data.id);
   if(e.data.type==='ready'){completed=true;clearTimeout(timer);setReady(true);setError('');setStatus('VWorld 3D 뷰어 초기화 완료 · 지형 표출은 화면에서 확인하세요.');}
   if(e.data.type==='error'){completed=true;clearTimeout(timer);setReady(false);setLocationPicking(false);setStatus('VWorld 연결 실패');setError(String(e.data.message));cancelPending('VWorld 연결 실패');}
   if(e.data.type==='layer-status'&&e.data.revision===layerRevisionRef.current&&typeof e.data.id==='string')setLayerStatus(s=>({...s,[e.data.id]:e.data.ok?'표시 준비 완료':'표시 실패 · 지도에 다시 연결해 주세요.'}));
   if(e.data.type==='coverage-status'&&e.data.requestId===coverageRequest.current)setCoverageRenderError(e.data.ok?'':'범위 시안을 지도에 표시하지 못했습니다. 지도에 다시 연결해 주세요.');
   if(e.data.type==='diagnostic-status'&&e.data.requestId===diagnosticRequest.current)setDiagnosticError(e.data.ok?'':'진단 기준점을 지도에 표시하지 못했습니다. 지도에 다시 연결해 주세요.');
   if(['terrain-heights','terrain-progress','terrain-error'].includes(e.data.type))visibilityReceiver.current(e.data);
   if(e.data.type==='visibility-status'&&e.data.requestId===visibilityRequest.current)visibility.setRenderError(e.data.ok?'':'지형 가림 시안을 지도에 표시하지 못했습니다. 다시 연결해 주세요.');
   if(e.data.type==='alarm-status'&&e.data.requestId===alarmRequest.current)setAlarmRenderError(e.data.ok?'':'알림 카메라를 지도에 표시하지 못했습니다. 다시 연결해 주세요.');
   if(e.data.type==='location-picked'&&pickingRef.current){
    if(validLocation(e.data.point)&&e.data.point.source==='map-surface'){setLocationPoint(e.data.point);setLocationError('');setTools('location');}
    else{setLocationPoint(null);setLocationError('지도 좌표 응답을 확인할 수 없습니다. 다시 지점을 선택하세요.');}
   }
   if(e.data.type==='location-error'&&pickingRef.current){setLocationPoint(null);setLocationError('지도 표면 위치를 읽지 못했습니다. 지형이 로딩된 곳을 다시 선택하거나 좌표를 직접 입력하세요.');setTools('location');}
   if(['geo-point-picked','geo-point-error'].includes(e.data.type)){
    const pending=geoPending.current;
    if(pending&&e.data.requestId===pending.id&&pending.cameraId===selectedRef.current){
     if(e.data.type==='geo-point-picked'&&validMapControlPoint(e.data.point)){geoPending.current=null;pending.cleanup();setGeoPicking(null);setGeoPickError('');post('geo-point-mode',{enabled:false});pending.resolve(e.data.point);}
     else setGeoPickError('지도 표면의 같은 지형을 선택하세요. 하늘이나 로딩되지 않은 지점은 사용할 수 없습니다.');
    }
   }
   if(e.data.type==='calibration-ready'||e.data.type==='calibration-error'){
    const p=pending.current.get(e.data.requestId);if(!p)return;clearTimeout(p.timer);pending.current.delete(e.data.requestId);
    if(e.data.type==='calibration-error')p.reject(new Error(String(e.data.message)));
    else if(Number.isFinite(e.data.groundElevationM)&&e.data.groundElevationM>=-500&&e.data.groundElevationM<=9000&&['operator','map-terrain'].includes(e.data.groundElevationSource))p.resolve({groundElevationM:e.data.groundElevationM,groundElevationSource:e.data.groundElevationSource});
    else p.reject(new Error('지도 높이 응답을 확인하세요.'));
   }
  };
  window.addEventListener('message',listener);return()=>{clearTimeout(timer);window.removeEventListener('message',listener);cancelGeoPick('지도 연결이 바뀌었습니다.');cancelPending('지도 연결이 바뀌었습니다.');};
 },[frame]);
 const markerDrawKey=JSON.stringify({positions,selected,sector:polygon});
 useEffect(()=>{if(frame&&ready)post('draw',JSON.parse(markerDrawKey));},[frame,ready,markerDrawKey]);
 function stopAutomaticView(message=''){
  setAutomaticView(false);automaticViewRequest.current='';automaticViewSent.current='';setAutomaticViewError(message);post('end-calibration');post('fit-layers',{bounds:extent});
 }
 function toggleAutomaticView(){
  if(automaticView){stopAutomaticView();return;}
  if(!currentAutomaticPose||!ready)return;
  cancelGeoPick('현재 카메라 시점으로 전환했습니다.');cancelPending('현재 카메라 시점으로 전환했습니다.');setCalibrating(false);setPreviewEpoch(v=>v+1);post('end-calibration');
  automaticViewSent.current='';setAutomaticViewError('');setAutomaticView(true);
 }
 useEffect(()=>{
  if(!automaticView)return;
  if(!ready||!active||tools!=='auto'||!automaticViewData){stopAutomaticView('최신 영상·PTZ를 확인할 수 없어 전체 감시 지도로 돌아왔습니다.');return;}
  if(automaticViewSent.current===automaticViewKey)return;
  automaticViewSent.current=automaticViewKey;automaticViewRequest.current=crypto.randomUUID();post('automatic-view',{requestId:automaticViewRequest.current,...automaticViewData});
 },[automaticView,automaticViewKey,ready,active,tools,frame]);
 useEffect(()=>{if(frame&&ready)post('layers',{revision:layerRevision,layers,visibleIds:visibleLayers});},[frame,ready,layers,layerRevision,visibleLayers]);
 useEffect(()=>{if(frame&&ready){coverageRequest.current=crypto.randomUUID();post('coverage',{requestId:coverageRequest.current,shapes:computedCoverageShapes,selected});}},[frame,ready,computedCoverageShapes,selected]);
 useEffect(()=>{if(frame&&ready){visibilityRequest.current=crypto.randomUUID();post('visibility',{requestId:visibilityRequest.current,results:displayedVisibility});}},[frame,ready,displayedVisibility]);
 useEffect(()=>{if(frame&&ready){alarmRequest.current=crypto.randomUUID();post('alarms',{requestId:alarmRequest.current,markers:alertMarkers});}},[frame,ready,alertMarkers]);
 useEffect(()=>{if(frame&&ready&&standalone&&publishedMap&&fittedFrame.current!==frame.session){fittedFrame.current=frame.session;post('fit-layers',{bounds:extent});}},[frame,ready]);
 useEffect(()=>{if(frame&&ready&&serverMode&&positions.some(p=>p.positionSource==='operator')&&fittedFrame.current!==frame.session){fittedFrame.current=frame.session;post('fit-layers',{bounds:extent});}},[frame,ready,serverMode,positions]);
 useEffect(()=>{if(frame&&ready)post('location-mode',{enabled:locationPicking});},[frame,ready,locationPicking]);
 useEffect(()=>{if(frame&&ready)post('location-point',{point:locationPoint});},[frame,ready,locationPoint]);
 useEffect(()=>{setDiagnosticError('');if(frame&&ready){diagnosticRequest.current=crypto.randomUUID();post('diagnostic-points',{requestId:diagnosticRequest.current,points:diagnosticPoints});}},[frame,ready,diagnosticPoints]);
 function fitDiagnostic(review:Review){
  if(!ready||!matchesDiagnosticCamera(review,current))return;
  cancelGeoPick('진단 기준점 전체 보기로 전환했습니다.');cancelPending('진단 기준점 전체 보기로 전환했습니다.');setPreviewEpoch(v=>v+1);setCalibrating(false);post('fit-layers',{bounds:diagnosticBounds(review),overhead:true});
 }
 useEffect(()=>{
  if(previousDiagnosticAspect.current===diagnosticAspect)return;
  previousDiagnosticAspect.current=diagnosticAspect;
  if(aspect!==null)return;
  cancelPending('진단 사진 비율이 변경돼 가상 시점 요청을 취소했습니다.');setPreviewEpoch(v=>v+1);setCalibrating(false);post('end-calibration');
 },[diagnosticAspect]);
 function preview(request:PreviewRequest,onlyGround=false):Promise<PreviewGround>{
  if(!frame||!ready)return Promise.reject(new Error('VWorld 3D에 먼저 연결하세요.'));
  cancelPending('새 가상 시점 요청으로 교체됐습니다.');if(!onlyGround)setCalibrating(true);
  return new Promise<PreviewGround>((resolve,reject)=>{
   const requestId=crypto.randomUUID(),timer=window.setTimeout(()=>{pending.current.delete(requestId);reject(new Error('가상 시점 응답 시간 초과. 지형 로딩을 확인하세요.'));},15000);
   pending.current.set(requestId,{resolve,reject,timer});post(onlyGround?'calibration-ground':'calibrate',{requestId,...request,aspectRatio:request.aspectRatio??diagnosticAspect});
  }).then(ground=>{if(!onlyGround&&tools!=='live')setTrialView({...request,...ground});return ground;});
 }
 function stopLiveView(){
  liveViewTicket.current++;
  if(!liveViewOwner.current)return;
  liveViewOwner.current=false;cancelPending('영상 추정 시점 갱신이 중지됐습니다.');setLiveView(null);setCalibrating(false);setPreviewEpoch(v=>v+1);post('end-calibration');
 }
 async function updateLiveView(view:LiveVisualView){
  if(!current||!ready||!active||tools!=='live'||view.source!=='device-approximate'&&!current.orientation)throw new Error('지도와 기준 시점을 확인하세요.');
  const captureTime=Date.parse(view.capturedAt);if(!Number.isFinite(captureTime)||Date.now()-captureTime>=4000)throw new Error('추정 화면이 만료됐습니다.');
  const id=++liveViewTicket.current;liveViewOwner.current=true;const selectedId=current.id;
  await preview({position:current,pose:view.pose,groundElevationM:view.source==='device-approximate'?view.groundElevationM??null:current.orientation!.groundElevationM,groundElevationSource:view.source==='device-approximate'?'operator':current.orientation!.groundElevationSource,aspectRatio:view.aspect});
  if(liveViewTicket.current!==id||selectedRef.current!==selectedId||Date.now()-captureTime>=4000){if(liveViewTicket.current===id)stopLiveView();return;}
  setLiveView(view);
 }
 function connect(apiKey=key){
  autoConnected.current=true;
  const session=crypto.randomUUID(),url='https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey='+encodeURIComponent(apiKey.trim());
  exitPreview();setReady(false);setError('');setStatus('VWorld SDK 연결 중…');
  setAppliedKey(apiKey.trim());setLocationPoint(null);setLocationError('');setLocationPicking(false);
  setLayerStatus({});
  setFrame({session,html:template.replace('__SDK_URL__',url.replaceAll('&','&amp;').replaceAll('"','&quot;')).replace('__SESSION__',session).replace('__APP_ORIGIN__',JSON.stringify(location.origin))});setKey('');
 }
 function applyBundle(text:string){
  const next=parseMapBundle(text);edits.current++;exitPreview();
  setConfiguration({schemaVersion:1,crs:'EPSG:4326',positions:next.positions});setSelected(next.positions[0]?.id??'');setDirty(true);setSimulation(false);
  setLayers(next.layers);setVisibleLayers(next.layers.map(l=>l.id));setLayerRevision(crypto.randomUUID());setLayerStatus({});setError('');
  setStorageStatus('지도 자료 불러옴 · 파일로 보관하세요.');
 }
 async function importBundle(file?:File){
  if(!file)return;try{if(file.size>MAX_MAP_FILE_BYTES)throw new Error('지도 자료는 8MB 이하여야 합니다.');applyBundle(await file.text());}catch(e){setError((e as Error).message);}
 }
 function downloadBundle(){const url=URL.createObjectURL(new Blob([JSON.stringify({...configuration,layers})],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-map-layers.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function importFile(file?:File){
  if(!file)return;try{if(file.size>1024*1024)throw new Error('좌표 파일은 1MB 이하여야 합니다.');
   const next=parseConfiguration(await file.text());edits.current++;exitPreview();setConfiguration(next);setSelected(next.positions[0]?.id??'');setDirty(true);setSimulation(false);setError('');
  }catch(e){setError((e as Error).message);}
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify(configuration,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='camera-map-positions.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function addPosition(){
  try{
   if(!latitude.trim()||!longitude.trim())throw new Error('설치 위도와 경도를 입력하세요.');
   const position:Position={id:crypto.randomUUID(),name:name.trim(),lat:Number(latitude),lon:Number(longitude),ssmUuid:uuid.trim()||null,positionSource:'operator',orientation:null};
   const kept=positions.every(p=>p.positionSource==='synthetic')?[]:positions;
   const next=parseConfiguration(JSON.stringify({...configuration,positions:[...kept,position]}));
   edits.current++;exitPreview();setConfiguration(next);setSelected(position.id);setDirty(true);setError('');setName('');setLatitude('');setLongitude('');setUuid('');
  }catch(e){setError((e as Error).message);}
 }
 function saveNativeProfile(profile:NativeProfile|null){
  if(!current)return;
  const next=parseConfiguration(JSON.stringify({...configuration,positions:positions.map(p=>{if(p.id!==current.id)return p;const {nativeTracking,...rest}=p;return profile?{...rest,nativeTracking:profile}:rest;})}));
  edits.current++;setConfiguration(next);setDirty(true);setStorageStatus('장비 추종 기준을 지도 설정에 반영했습니다. 중앙 저장 또는 JSON으로 보관하세요.');
 }
 function updateInstallation(lat:number,lon:number){
  if(!current||current.lat===lat&&current.lon===lon)return;
  try{
   const next=parseConfiguration(JSON.stringify({...configuration,positions:positions.map(p=>{
    if(p.id!==current.id)return p;
    const {nativeTracking,...rest}=p;
    return {...rest,lat,lon,positionSource:'operator',orientation:null};
   })}));
   edits.current++;stopLiveView();exitPreview();setTrialView(null);setConfiguration(next);setDirty(true);setError('');
   setStorageStatus(`${current.name} 설치 좌표 수정 완료 · 이 카메라의 방향·추종 기준을 다시 잡고 중앙 저장하세요.`);
  }catch(e){setError((e as Error).message);}
 }
 function saveOrientation(orientation:ManualOrientation){
  if(!current)return;
  const next=parseConfiguration(JSON.stringify({...configuration,positions:positions.map(p=>p.id===current.id?{...p,orientation}:p)}));
  edits.current++;setConfiguration(next);setDirty(true);
 }
 async function saveCentral(){
  if(revision===null)return;const ticket=edits.current;setSaving(true);setError('');
  try{
   const result=await requestMap({method:'PUT',headers:{'Content-Type':'application/json','X-Inventory-Write-Key':writeKey},body:JSON.stringify({configurationRevision:revision,configuration})});
   if(ticket===edits.current){setConfiguration(result.configuration);setDirty(false);}setRevision(result.revision);setWriteKey('');setStorageStatus(ticket===edits.current?'중앙 지도 설정 저장 완료 · 다른 브라우저에서 다시 불러올 수 있습니다.':'이전 설정 저장 완료 · 이후 변경은 추가 저장이 필요합니다.');
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 const mapAspect=automaticView?automaticAspect:liveView?.aspect??aspect??diagnosticAspect;
 const mapPanel=<div className="map-panel" data-reference={mapAspect?'true':undefined} style={mapAspect?{height:'auto',aspectRatio:mapAspect,'--reference-aspect':mapAspect} as CSSProperties:undefined}>{frame?<iframe key={frame.session} title="VWorld 3D 지도" ref={iframe} src={import.meta.env.BASE_URL+'vworld-viewer.html'} sandbox="allow-scripts allow-same-origin" onLoad={()=>iframe.current?.contentWindow?.postMessage({scope:'vworld-bootstrap',type:'initialize',html:frame.html},location.origin)}/>:<><p className="schematic-label">좌표 배치도 · 실제 지형 아님 · 북쪽 ↑</p><svg viewBox="0 0 800 480" role="img" aria-label="북한산 시험 카메라 좌표 배치도">{displayedLines.map(({layer,lines})=><g key={layer.id} data-layer={layer.id}>{lines.map((line,i)=><polyline key={i} points={line.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} fill="none" stroke={layer.kind==='boundary'?'#71f2cf':'#ffca68'} strokeWidth={layer.kind==='boundary'?2.5:1.5}/>)}</g>)}{coverageShapes.map(shape=><g key={shape.cameraId} data-coverage={shape.cameraId} onClick={()=>selectPosition(shape.cameraId)}><polygon points={shape.coordinates.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} fill={shape.color} fillOpacity={shape.cameraId===selected?'.28':'.16'} stroke={shape.color} strokeWidth={shape.cameraId===selected?2:1}/><polyline points={shape.centerline.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} stroke={shape.color} strokeDasharray="5 4"/></g>)}{polygon&&<polygon points={polygon.map(([lon,lat])=>xy(lon,lat).join(',')).join(' ')} fill="#f5a623" fillOpacity=".35" stroke="#f5a623"/>}{diagnosticPoints.map(p=>{const[x,y]=xy(p.lon,p.lat);return <g key={p.number} data-diagnostic={p.number}><circle cx={x} cy={y} r={7} fill={p.validation?'#bc8aff':'#ee984b'}/><text x={x+10} y={y-10} fill="white" fontSize="13">{p.number+' · '+p.label}</text></g>;})}{positions.map(p=>{const[x,y]=xy(p.lon,p.lat),alarm=alertMarkers.find(a=>a.cameraId===p.id);return <g key={p.id} data-alert={alarm?.cameraId} onClick={()=>selectPosition(p.id)}>{alarm&&<><title>{`알림 자료 ${alarm.count}건 · ${p.name} · 카메라 위치 · 연기 위치 미확인`}</title><circle cx={x} cy={y} r={16} fill="none" stroke="#ff7474" strokeWidth={3}/></>}<circle cx={x} cy={y} r={p.id===selected?10:6} fill="#55deed"/><text x={x+14} y={y+5} fill="white" fontSize="16">{p.name}</text></g>;})}</svg></>}</div>;
 return <main className="monitoring map-workspace" data-live={tools==='live'||tools==='auto'||serverMode&&tools!=='cameras'?'true':undefined}>
  <div className="map-topbar"><div><strong>VWorld 3D · 산불감시 지도</strong><span role="status">{status}</span></div><div className="map-tool-tabs" aria-label="지도 도구">
   {canManage&&<button aria-pressed={tools==='cameras'} onClick={()=>setTools(tools==='cameras'?'':'cameras')}>카메라·설정</button>}
   <button aria-pressed={tools==='alerts'} onClick={()=>setTools(tools==='alerts'?'':'alerts')}>AI 감지 알림</button>
   {!standalone&&!serverMode&&<button aria-pressed={tools==='live'} onClick={()=>setTools(tools==='live'?'':'live')}>실시간 영상</button>}
   {serverMode&&<button aria-pressed={tools==='auto'} onClick={()=>setTools('auto')}>자동 감시</button>}
   <button aria-pressed={tools==='coverage'} onClick={()=>setTools(tools==='coverage'?'':'coverage')}>관측 범위</button>
   {canManage&&<><button aria-pressed={tools==='layers'} onClick={()=>setTools(tools==='layers'?'':'layers')}>지도 레이어</button><button aria-pressed={tools==='location'} onClick={()=>setTools(tools==='location'?'':'location')}>위치·지번</button><button aria-pressed={tools==='connection'} onClick={()=>setTools(tools==='connection'?'':'connection')}>지도 연결</button></>}
  </div></div>
  {error&&<p role="alert" className="error map-error">{error}</p>}
  <div className="monitor-grid">{canManage&&<aside className="map-floating camera-panel" hidden={tools!=='cameras'}><h2>카메라 위치</h2>
   {positions.map(p=><button className={p.id===selected?'camera active':'camera'} key={p.id} onClick={()=>selectPosition(p.id)}>{p.name}<small>{p.positionSource==='synthetic'?'시험 좌표':'입력 좌표'} · {p.orientation?.status==='estimate'?'영상·지형 추정':'방향 UNKNOWN'}{p.nativeTracking?' · 장비 기준 있음':''}</small></button>)}
   <button disabled={!current||!ready} onClick={exitPreview}>선택 위치로 지도 이동</button>
   <p>위도 {current?.lat??'—'} / 경도 {current?.lon??'—'}<br/>SSM UUID: {current?.ssmUuid??'미연결'}</p>
   {current&&<InstallationPositionEditor key={'installation:'+current.id+':'+current.lat+':'+current.lon} position={current} onApply={updateInstallation}/>}
   {current&&<DiagnosticReview key={current.id+':'+current.lat+':'+current.lon} position={current} ready={ready&&active} onDocument={setDiagnostic} onFit={fitDiagnostic} renderError={diagnosticError}/>}
   <details><summary>설치 위치 추가</summary><label>카메라 위치 이름<input value={name} onChange={e=>setName(e.target.value)} maxLength={200}/></label><label>설치 위도<input type="number" value={latitude} onChange={e=>setLatitude(e.target.value)}/></label><label>설치 경도<input type="number" value={longitude} onChange={e=>setLongitude(e.target.value)}/></label><label>SSM UUID(선택)<input value={uuid} onChange={e=>setUuid(e.target.value)}/></label><button onClick={addPosition}>설치 위치 추가하기</button><p className="help">처음 실제 위치를 추가하면 초기 시험 좌표를 대체합니다. UUID는 확인된 값만 입력하세요.</p></details>
   <label>위도·경도 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void importFile(e.target.files?.[0]);e.target.value='';}}/></label><button onClick={download}>좌표 설정 다운로드</button>
   <p className="help">JSON에는 저장한 추정값·기준점 메타데이터가 포함됩니다. 지도 키·참조 이미지·시험 부채꼴 값은 포함하지 않습니다.</p>
   <p className="help">{positions.every(p=>p.positionSource==='synthetic')?'초기 지점은 임의 시험 좌표입니다. ':''}지도 마커를 눌러도 위치를 선택할 수 있습니다. 경계·탐방로는 지도 레이어에서 표시를 조정하세요.</p>
   <details className="map-storage" open><summary>설정 보관</summary>
   <p>{storageStatus} {dirty&&'· 저장하지 않은 변경'}</p>
   {!standalone&&<>{!serverMode&&<label>지도 저장 키<input type="password" autoComplete="off" value={writeKey} onChange={e=>setWriteKey(e.target.value)}/></label>}<button disabled={saving||!dirty||!serverMode&&!writeKey||revision===null} onClick={()=>void saveCentral()}>중앙 지도 설정 저장</button><button disabled={saving} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 지도 설정을 버리고 다시 불러올까요?'))void loadCentral();}}>중앙 지도 설정 다시 불러오기</button></>}
   </details>
  <details className="simulation"><summary>시험 방향 표시</summary><label className="inline"><input type="checkbox" checked={showEstimate} disabled={!estimate} onChange={e=>setShowEstimate(e.target.checked)}/>저장 추정 방향 부채꼴 표시</label><label className="inline"><input type="checkbox" checked={simulation} onChange={e=>setSimulation(e.target.checked)}/>시험 방향 부채꼴 표시</label><p>부채꼴은 수평 방향 시각화입니다. 표시 거리는 임의값이며 산에 가리는 구간이나 실제 촬영 범위를 계산하지 않습니다. 가상 시점 보정 중에는 부채꼴을 숨깁니다.</p><div className="simulation-controls">{simulation&&<><label>시험 방위각 {heading}° (북=0°, 동=90°)<input type="range" min="0" max="359" value={heading} onChange={e=>setHeading(Number(e.target.value))}/></label><label>시험 수평 화각 {fov}°<input type="range" min="10" max="120" value={fov} onChange={e=>setFov(Number(e.target.value))}/></label></>}<label>표시 거리 {range}m<input type="range" min="100" max="3000" step="100" value={range} onChange={e=>setRange(Number(e.target.value))}/></label></div></details>
  </aside>}
  <aside className="map-floating coverage-panel" hidden={tools!=='coverage'}>{serverMode?<><h2>현재 관측 범위</h2><p>최신 PTZ 범위 {runtimeCoverage.length}/{positions.length}대 · 수신이 끊긴 범위는 숨깁니다.</p><label><input type="checkbox" checked={!coverageHidden} onChange={e=>setCoverageHidden(!e.target.checked)}/>현재 관측 범위 표시</label><label><input type="checkbox" checked={coverageSelectedOnly} onChange={e=>setCoverageSelectedOnly(e.target.checked)}/>선택 카메라만 표시</label><button onClick={()=>{exitPreview();post('fit-layers',{bounds:extent});}}>전체 현재 범위 보기</button><p>저장한 지도 기준과 현재 PTZ로 계산한 수평 근사 범위이며 거리는 서버에 등록한 표시 거리입니다.</p></>:<><CoverageControls positions={positions} current={current} plans={coveragePlans} hidden={coverageHidden} selectedOnly={coverageSelectedOnly} suspended={calibrating} storageStatus={coverageStorageStatus} onSelect={selectPosition} onPlans={setCoveragePlans} onHidden={setCoverageHidden} onSelectedOnly={setCoverageSelectedOnly} onStorageStatus={setCoverageStorageStatus}/><TerrainVisibilityControls current={current} plan={coveragePlans.find(p=>p.cameraId===selected)} ready={ready} suspended={calibrating} visibility={visibility}/><button disabled={!ready||!coverageShapes.length} onClick={()=>{exitPreview();post('fit-layers',{bounds:extent});}}>전체 범위 시안 보기</button>{coverageRenderError&&<p role="alert" className="error">{coverageRenderError}</p>}</>}</aside>
  {canManage&&<aside className="map-floating layers-panel" hidden={tools!=='layers'}><h2>지도 레이어</h2>
   {standalone&&publishedMap&&<p className="help">북한산 공원경계·탐방로와 카메라 9개를 기본 표시합니다. 파일을 선택할 필요가 없습니다.</p>}
   {layers.length?layers.map(l=><div className="layer-row" key={l.id}><label className="inline"><input type="checkbox" checked={visibleLayers.includes(l.id)} onChange={e=>setVisibleLayers(ids=>e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))}/><span><i className={'layer-swatch '+l.kind}/>{l.name}</span></label><small>{l.geojson.features.length}개 도형 · 자료 기준 {l.sourceDate}<br/>{!visibleLayers.includes(l.id)?'숨김':!frame?'좌표 배치도 표시':layerStatus[l.id]??'지도 표시 준비 중…'}</small></div>):<p>불러온 경계·탐방로가 없습니다.</p>}
   <button disabled={!ready||!extentPoints.length} onClick={()=>{exitPreview();post('fit-layers',{bounds:extent});}}>전체 위치·경계 보기</button>
   <button disabled={!layers.length} onClick={downloadBundle}>지도자료 전체 다운로드</button>
   <details><summary>다른 지도자료 사용 (선택)</summary><label>지도자료 JSON 불러오기<input type="file" accept=".json,application/json" onChange={e=>{void importBundle(e.target.files?.[0]);e.target.value='';}}/></label><p className="help">카메라 좌표·경계·탐방로를 함께 바꿉니다. 선택한 파일은 이 브라우저에서 읽으며 서버에 업로드하지 않습니다.</p></details>
   <p className="help">지도자료 전체 파일에는 현재 카메라 설정과 레이어가 포함됩니다. 중앙 설정 저장은 카메라 위치·보정값을 저장합니다.</p>
  </aside>}
  {canManage&&<aside className="map-floating connection-panel" hidden={tools!=='connection'}><h2>지도 연결</h2>
   {deploymentKey?<><p className="success">등록된 지도 키 자동 사용 · 다시 입력할 필요 없습니다.</p><button onClick={()=>connect(deploymentKey)}>등록된 키로 다시 연결</button><details><summary>다른 키로 연결 (선택)</summary><label>VWorld 3D 키<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><button onClick={()=>connect()} disabled={!key.trim()}>VWorld 3D 연결</button></details></>:<><label>VWorld 3D 키<input type="password" autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><button onClick={()=>connect()} disabled={!key.trim()}>VWorld 3D 연결</button></>}
   <button onClick={()=>{exitPreview();setFrame(null);setReady(false);setLocationPicking(false);setLocationPoint(null);setLocationError('');setAppliedKey('');setStatus('좌표 배치도 · VWorld 미연결');setError('');}}>좌표 배치도로 보기</button>
   <p className="help">{deploymentKey?'배포된 지도 키를 사용합니다.':'등록된 키가 없으면 이 화면에서 직접 입력할 수 있습니다.'} 키는 지도 요청 시 브라우저에 전달됩니다. VWorld에 이 사이트 주소를 등록하세요.</p><p className="help">현재 사이트: {location.origin}{import.meta.env.BASE_URL}</p>
  </aside>}
  {canManage&&<aside className="map-floating location-panel" hidden={tools!=='location'}><LocationLookup point={locationPoint} picking={locationPicking} ready={ready} apiKey={appliedKey} pickError={locationError} onPicking={v=>{setLocationPicking(v);setLocationError('');}} onPoint={p=>{setLocationPoint(p);setLocationError('');}}/></aside>}
  <aside className="map-floating smoke-alert-panel" hidden={tools!=='alerts'}>{calibrating&&<p className="help">가상 시점 보정 중 알림 카메라 표시 숨김</p>}{canManage?<SmokeAlerts document={alertDocument} bindings={alertBindings} positions={positions} hidden={alertsHidden} onDocument={setAlertDocument} onBindings={setAlertBindings} onHidden={setAlertsHidden} onSelect={selectPosition} renderError={alarmRenderError}/>:<><h2>AI 감지 알림</h2><p>AI 연동 준비 중 · 현재 실제 감지 알림을 수신하지 않습니다.</p></>}</aside>
  {serverMode&&tools==='auto'&&<aside className="map-floating map-live-panel"><AutomaticMonitoringPanel positions={positions} current={current} state={automatic.state} now={automatic.now} error={automatic.error} onView={toggleAutomaticView} viewing={automaticView} viewReady={ready} viewError={automaticViewError} onSelect={selectPosition} onFit={()=>{exitPreview();post('fit-layers',{bounds:extent});}}/></aside>}
  {!standalone&&active&&tools==='live'&&<aside className="map-floating map-live-panel"><p className="help">선택 지도 위치: {current?.name??'없음'} · 수집 영상과의 장비 일치 미확인</p><label>추종할 설치 카메라<select value={selected} onChange={e=>selectPosition(e.target.value)}>{positions.map(p=><option key={p.id} value={p.id}>{p.name}{p.nativeTracking?' · 기준 저장됨':''}</option>)}</select></label><LiveCapture key={current?.id} active desktopDemo={desktopDemo} embedded cameraLabel={current?.name} onFrame={setCaptureFrame} onPtz={setNativePtz}/><label>지도 추종 방식<select value={trackingMode} onChange={e=>{stopLiveView();setTrackingMode(e.target.value);}}><option value="visual">영상 대응 추정</option><option value="device">장비 PTZ 근사 추종</option></select></label>{trackingMode==='device'?<NativePtzTracking key={current?.id+':'+current?.lat+':'+current?.lon} position={current} frame={captureFrame} device={nativePtz} initial={trialView&&trialView.position.id===current?.id&&trialView.position.lat===current.lat&&trialView.position.lon===current.lon?trialView:null} mapReady={ready} onView={updateLiveView} onStop={stopLiveView} onSave={saveNativeProfile}/>:<VisualTracking key={JSON.stringify([current?.id,current?.lat,current?.lon,current?.orientation])} position={current} frame={captureFrame} mapReady={ready} onView={updateLiveView} onStop={stopLiveView}/>}<p className="help">시험 시점은 지도 설정에 자동 저장하지 않습니다.</p></aside>}
  <div className="terrain-workspace">
   <div className="map-surface">{mapPanel}</div>
   {canManage&&current&&<TerrainCalibration key={current.id+':'+current.lat+':'+current.lon} position={current} ready={ready&&active&&tools!=='live'} previewEpoch={previewEpoch} onPreview={preview} onReadGround={request=>preview(request,true)} onPickPoint={pickGeoPoint} onAspect={setAspect} onSave={saveOrientation} onExit={exitPreview}/>}
  </div></div>
  {(coverageShapes.length>0||calibrating&&coveragePlans.length>0)&&<div className="coverage-disclaimer">{coverageRenderError?'범위 시안 표시 실패':serverMode?`현재 PTZ 근사 관측 범위 ${coverageShapes.length}대 · 표시 거리 기준`:calibrating?'가상 시점 보정 중 범위 시안 숨김':displayedVisibility.length?`지형 가림 시안 ${displayedVisibility.length}대 · 초록 비가림 추정 / 빨강 가림 추정 / 노랑 미확인 · 실제 촬영 범위 미검증`:`범위 시안 ${coverageShapes.length}대 · 실제 촬영 범위·지형 가림 미확인`}</div>}
  {locationPicking&&<div className="location-picking-status">위치 선택 중 · 지형 지점을 클릭하세요 <button onClick={()=>setLocationPicking(false)}>종료</button></div>}
  {geoPicking&&<div className="location-picking-status">기준점 지정 중 · 사진과 같은 지형의 정확한 지점을 지도에서 클릭하세요. {geoPickError}<button onClick={()=>cancelGeoPick('기준점 지정을 취소했습니다.')}>기준점 지정 종료</button></div>}
  <div className="map-bottom-status">{current?.name??'위치 없음'} · {serverMode?(runtimeCoverage.some(c=>c.cameraId===selected)?(automaticView?'현재 카메라 시점 · 장비 PTZ 근사 추종':'현재 PTZ 관측 방향(근사)'):'현재 방향 미확인 · 최신 영상·PTZ 대기'):liveView?.source==='device-approximate'?'장비 PTZ 근사 추종 · 절대 방향 오차 허용':liveView?'영상 대응 추정 · 기준 정확도 미검증':estimate?'영상·지형 추정 · 실시간 확인 안 됨':'현재 방향 미확인'} · CCTV 제어 없음</div>
 </main>;
}
