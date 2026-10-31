import {normalizeISBN} from './data';
type Rect={left:number;top:number;width:number;height:number};
export function cameraCrop(videoWidth:number,videoHeight:number,display:Rect,frame:Rect){
 if(!videoWidth||!videoHeight||!display.width||!display.height||!frame.width||!frame.height)return null;
 const scale=Math.max(display.width/videoWidth,display.height/videoHeight);
 const x=Math.max(0,(frame.left-display.left+(videoWidth*scale-display.width)/2)/scale);
 const y=Math.max(0,(frame.top-display.top+(videoHeight*scale-display.height)/2)/scale);
 const width=Math.min(videoWidth-x,frame.width/scale),height=Math.min(videoHeight-y,frame.height/scale);
 return width>0&&height>0?{x,y,width,height}:null;
}
export function cameraError(error:unknown){
 if(error instanceof DOMException&&['NotAllowedError','PermissionDeniedError'].includes(error.name))return 'Accesso alla fotocamera negato. Puoi abilitarlo nelle impostazioni del sito oppure usare l’inserimento manuale.';
 if(error instanceof DOMException&&error.name==='NotFoundError')return 'Nessuna fotocamera disponibile. Puoi inserire il libro manualmente.';
 if(error instanceof DOMException&&error.name==='NotReadableError')return 'La fotocamera è occupata da un’altra app. Chiudila oppure usa l’inserimento manuale.';
 return 'Non riesco ad avviare la fotocamera. Riprova oppure usa l’inserimento manuale.';
}
export function startISBNScanner(video:HTMLVideoElement,frame:HTMLElement,onISBN:(isbn:string)=>void,onReady:()=>void,onError:(message:string)=>void){
 let active=true,media:MediaStream|null=null,timer:ReturnType<typeof setTimeout>|undefined;
 function stop(){active=false;clearTimeout(timer);media?.getTracks().forEach(t=>t.stop());if(media&&video.srcObject===media){video.pause();video.srcObject=null;}media=null;}
 async function start(){
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){if(active)onError('La fotocamera richiede HTTPS. Apri il sito GitHub Pages oppure usa l’inserimento manuale.');return;}
  try{
   const [{BrowserMultiFormatReader},{BarcodeFormat,DecodeHintType}]=await Promise.all([import('@zxing/browser'),import('@zxing/library')]);if(!active)return;
   const granted=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
   if(!active){granted.getTracks().forEach(t=>t.stop());return;}media=granted;video.srcObject=media;await video.play();if(!active)return;
   const hints=new Map();hints.set(DecodeHintType.POSSIBLE_FORMATS,[BarcodeFormat.EAN_13]);hints.set(DecodeHintType.TRY_HARDER,true);const reader=new BrowserMultiFormatReader(hints);
   const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Canvas non disponibile.');onReady();
   function scan(){if(!active)return;
    if(video.readyState>=2){const crop=cameraCrop(video.videoWidth,video.videoHeight,video.getBoundingClientRect(),frame.getBoundingClientRect());
     if(crop){const scale=Math.min(1,1000/crop.width);canvas.width=Math.max(1,Math.round(crop.width*scale));canvas.height=Math.max(1,Math.round(crop.height*scale));context!.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
      try{const isbn=normalizeISBN(reader.decodeFromCanvas(canvas).getText());if(isbn){stop();onISBN(isbn);return;}}catch{/* No valid ISBN in this frame. */}
     }
    }timer=setTimeout(scan,220);
   }scan();
  }catch(error){if(active){stop();onError(cameraError(error));}}
 }void start();return stop;
}
