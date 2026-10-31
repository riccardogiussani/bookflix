import {afterEach,expect,it,vi} from 'vitest';
import {cameraCrop,cameraError,startISBNScanner} from './camera';
const decode=vi.hoisted(()=>vi.fn());
vi.mock('@zxing/browser',()=>({BrowserMultiFormatReader:class {decodeFromCanvas=decode;}}));
vi.mock('@zxing/library',()=>({BarcodeFormat:{EAN_13:1},DecodeHintType:{POSSIBLE_FORMATS:1,TRY_HARDER:2}}));
const stops:(()=>void)[]=[];
afterEach(()=>{stops.forEach(stop=>stop());stops.length=0;decode.mockReset();vi.unstubAllGlobals();});
function setup(getUserMedia?:()=>Promise<unknown>){
 const stop=vi.fn(),media={getTracks:()=>[{stop}]},drawImage=vi.fn();
 vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:getUserMedia||vi.fn().mockResolvedValue(media)}});
 vi.stubGlobal('document',{createElement:()=>({width:0,height:0,getContext:()=>({drawImage})})});
 const video={srcObject:null,play:vi.fn().mockResolvedValue(undefined),pause:vi.fn(),readyState:2,videoWidth:1920,videoHeight:1080,getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})} as unknown as HTMLVideoElement;
 const frame={getBoundingClientRect:()=>({left:35,top:300,width:320,height:180})} as HTMLElement;
 return {video,frame,stop,media,drawImage};
}
it('calcola il ritaglio del riquadro sul video verticale senza leggere fuori dall’immagine',()=>{const crop=cameraCrop(1920,1080,{left:0,top:0,width:390,height:844},{left:35,top:300,width:320,height:180})!;expect(crop.x).toBeGreaterThan(0);expect(crop.x+crop.width).toBeLessThanOrEqual(1920);expect(crop.y+crop.height).toBeLessThanOrEqual(1080);expect(crop.width/crop.height).toBeCloseTo(320/180);expect(cameraCrop(0,0,{left:0,top:0,width:0,height:0},{left:0,top:0,width:0,height:0})).toBeNull();});
it('ferma la fotocamera prima di consegnare l’ISBN e non ripete la lettura',async()=>{const {video,frame,stop,drawImage}=setup();decode.mockReturnValue({getText:()=> '9788834603000'});const onISBN=vi.fn(()=>expect(stop).toHaveBeenCalledOnce()),onReady=vi.fn(),onError=vi.fn();stops.push(startISBNScanner(video,frame,onISBN,onReady,onError));await vi.waitFor(()=>expect(onISBN).toHaveBeenCalledWith('9788834603000'));expect(onISBN).toHaveBeenCalledOnce();expect(onReady).toHaveBeenCalledOnce();expect(onError).not.toHaveBeenCalled();expect(drawImage).toHaveBeenCalledOnce();expect(video.srcObject).toBeNull();});
it('non consegna codici EAN non bibliografici o ISBN con checksum errato',async()=>{const {video,frame}=setup();decode.mockReturnValue({getText:()=> '9788834603001'});const onISBN=vi.fn();stops.push(startISBNScanner(video,frame,onISBN,vi.fn(),vi.fn()));await vi.waitFor(()=>expect(decode).toHaveBeenCalled());expect(onISBN).not.toHaveBeenCalled();});
it('spegne anche una fotocamera autorizzata dopo il passaggio al manuale',async()=>{let grant!:(value:unknown)=>void;const pending=new Promise(resolve=>{grant=resolve;});const getUserMedia=vi.fn(()=>pending);const {video,frame,stop,media}=setup(getUserMedia);const onISBN=vi.fn(),onReady=vi.fn();const cancel=startISBNScanner(video,frame,onISBN,onReady,vi.fn());stops.push(cancel);await vi.waitFor(()=>expect(getUserMedia).toHaveBeenCalled());cancel();grant(media);await vi.waitFor(()=>expect(stop).toHaveBeenCalledOnce());expect(video.play).not.toHaveBeenCalled();expect(onReady).not.toHaveBeenCalled();expect(onISBN).not.toHaveBeenCalled();});
it('gestisce il rifiuto del permesso senza lasciare la ricerca attiva',async()=>{const {video,frame}=setup(()=>Promise.reject(new DOMException('denied','NotAllowedError')));const onError=vi.fn(),onISBN=vi.fn();stops.push(startISBNScanner(video,frame,onISBN,vi.fn(),onError));await vi.waitFor(()=>expect(onError).toHaveBeenCalledWith(expect.stringContaining('negato')));expect(onISBN).not.toHaveBeenCalled();});
it('su HTTP non sicuro propone il manuale senza chiedere la fotocamera',async()=>{const getUserMedia=vi.fn();const {video,frame}=setup(getUserMedia);vi.stubGlobal('window',{isSecureContext:false});const onError=vi.fn();stops.push(startISBNScanner(video,frame,vi.fn(),vi.fn(),onError));expect(onError).toHaveBeenCalledWith(expect.stringContaining('HTTPS'));expect(getUserMedia).not.toHaveBeenCalled();});
it('spiega quando la fotocamera è occupata',()=>{expect(cameraError(new DOMException('busy','NotReadableError'))).toContain('occupata');});
