const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),os=require('node:os');
const base=path.join(__dirname,'../dist/')+path.sep;
const output=path.resolve(process.env.QA_OUTPUT_DIR||path.join(os.tmpdir(),'sokoban-campaign-qa'));
fs.mkdirSync(output,{recursive:true});
const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const read=f=>fs.readFileSync(base+f,'utf8'),script=s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'</script>';
const fixture=require('../tests/fixtures/box-campaign-routes.json'),routes=[];
for(const [chapter,entries]of Object.entries(fixture))for(const [i,entry]of entries.entries())routes.push({chapter,n:i+1,index:routes.length,solved:true,...entry});
const boot="const qaStore={};Object.defineProperty(window,'localStorage',{value:{getItem:k=>qaStore[k]??null,setItem:(k,v)=>qaStore[k]=v,removeItem:k=>delete qaStore[k]}});Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>qaStore[k]??null,setItem:(k,v)=>qaStore[k]=v,removeItem:k=>delete qaStore[k]}});window.addEventListener('error',e=>document.documentElement.setAttribute('data-qa-result',JSON.stringify({error:e.message,at:e.lineno})));";
const files=['box-rooms.js','box-levels.js','box-clone-levels.js','box-transfer-levels.js','box-open-levels.js','box-flip-levels.js','box-cycle-levels.js','box-player-levels.js','box-possess-levels.js','box-wall-levels.js','box-portals.js','route-input.js','box-intro.js'];
let template=read('box-intro.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link[^>]*rel="stylesheet"[^>]*>/gi,'');
template=template.replace('</head>','<style>'+read('style.css')+read('box-intro.css')+'</style></head>');
async function runBrowser(file,width,chapter){
 const browser=cp.spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-extensions','--host-resolver-rules=MAP * ~NOTFOUND','--hide-scrollbars','--remote-debugging-pipe','--user-data-dir='+path.join(output,'chrome-'+process.pid)],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
 const pending=new Map();let serial=0,buffer='',errors='';browser.stderr.on('data',chunk=>errors+=chunk);
 browser.stdio[4].setEncoding('utf8');
 const rejectPending=error=>{for(const handler of pending.values())handler.reject(error);pending.clear();};
 browser.on('error',rejectPending);
 browser.on('exit',()=>rejectPending(Error('Chrome exited before completing the check')));
 browser.stdio[4].on('data',chunk=>{buffer+=chunk;let p;while((p=buffer.indexOf('\0'))>=0){const item=JSON.parse(buffer.slice(0,p));buffer=buffer.slice(p+1);if(item.id&&pending.has(item.id)){const handler=pending.get(item.id);pending.delete(item.id);item.error?handler.reject(Error(JSON.stringify(item.error))):handler.resolve(item.result);}}});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});browser.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 const timer=setTimeout(()=>{rejectPending(Error('Chrome check timed out'));browser.kill();},120000);
 try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
  await send('Page.navigate',{url:'file:///'+file},sessionId);
  let result;
  for(let i=0;i<1200;i++){await new Promise(r=>setTimeout(r,75));const response=await send('Runtime.evaluate',{expression:'document.documentElement.getAttribute("data-qa-result")',returnByValue:true},sessionId);if(response.result.value){result=JSON.parse(response.result.value);break;}}
  if(!result)throw Error('No result '+errors.slice(-200));
  const shot=await send('Page.captureScreenshot',{format:'png'},sessionId);fs.writeFileSync(output.replace(/\\/g,'/')+'/all-campaign-'+width+'-'+chapter+'.png',Buffer.from(shot.data,'base64'));
  return result;
 }finally{clearTimeout(timer);browser.kill();}
}
(async()=>{
const all=[];const width=Number(process.argv[2]||1100),only=process.argv[3];
for(const chapter of [...new Set(routes.map(r=>r.chapter))].filter(ch=>!only||ch===only)){
 const selected=routes.filter(r=>r.chapter===chapter);
 const qa=`setTimeout(async()=>{
 const entries=${JSON.stringify(selected)},results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
 for(const entry of entries){const result={chapter:entry.chapter,n:entry.n,steps:0,issues:[]};try{
  openLevel(entry.index);await wait(25);
  if(levelButtons.length!==entries.length)throw Error('Level buttons missing');
  const checkLayout=()=>{
   if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Page exceeds viewport');
   if(textView)return;
   const outer=stage.getBoundingClientRect(),inner=board.getBoundingClientRect();
   if(inner.width>outer.width+2||inner.height>outer.height+2)throw Error('Board overflows stage '+inner.width+'x'+inner.height+' / '+outer.width+'x'+outer.height);
   for(const canvas of board.querySelectorAll('.room-box canvas')){const c=canvas.getBoundingClientRect(),p=canvas.parentElement.getBoundingClientRect();if(c.width>p.width+2||c.height>p.height+2)throw Error('Preview overflows room '+Math.round(c.width)+'x'+Math.round(c.height)+' / '+Math.round(p.width)+'x'+Math.round(p.height));}
  };
  try{checkLayout();}catch(e){result.issues.push(e.message);}
  // Every interior is opened through its displayed room button, then returned.
  const roomButtons=[...board.querySelectorAll('button.room-box')];
  for(const shell of roomButtons.map(b=>Number(b.dataset.shell))){
   const button=board.querySelector('button[data-shell="'+shell+'"]');if(!button)throw Error('Room preview missing');
   const child=map.inside[shell],playerRoom=state.positions[state.activePlayer??playerIds()[0]][0];
   button.click();if(inspectedRoom===null&&child!==playerRoom)throw Error('Room click did not inspect');await wait(15);clearRoomMotion();clearBoxMotion();render();checkLayout();
   $('intro-return').click();if(inspectedRoom!==null)throw Error('Return to player failed');clearRoomMotion();render();
  }
  if(!entry.solved){result.unsolved=true;results.push(result);continue;}
  let sim=state,visual='';
  for(const d of entry.route){const direction='URDL'.indexOf(d),v=Boolean(playerViews.get(sim))&&direction%2?direction^2:direction;visual+='WDSA'[v];const next=step(map,sim,direction);if(next===sim)throw Error('Reference route blocked');playerViews.set(next,viewAfterCrossings(sim,next));sim=next;}
  const input=$('route-input').querySelector('textarea'),load=$('route-input').querySelector('.route-load'),next=$('route-input').querySelector('.route-next');
  input.value=visual;load.click();
  let animated=false;
  for(let i=0;i<entry.route.length;i++){
   const before=state;if(next.disabled)throw Error('Single-step stopped early '+i);next.click();if(state===before)throw Error('Single-step did not execute '+i+' '+$('route-input').querySelector('.route-status').textContent);result.steps++;
   if(!animated&&(state.crossings?.length||state.transfers?.length)){await wait(280);animated=true;}
   clearRoomMotion();clearBoxMotion();
  }
  if(!won(map,state))throw Error('Route did not win in UI');
  if(JSON.stringify(state.positions)!==JSON.stringify(sim.positions))throw Error('UI and rules diverged');
  const saved=JSON.stringify(state);$('intro-undo').click();if(JSON.stringify(state)===saved)throw Error('Undo failed');$('intro-redo').click();if(JSON.stringify(state)!==saved)throw Error('Redo failed');clearRoomMotion();clearBoxMotion();render();
  try{checkLayout();}catch(e){if(!result.issues.includes(e.message))result.issues.push(e.message);}
  if(!$('intro-next').disabled&&entry.index<levels.length-1){$('intro-next').click();if(active!==entry.index+1)throw Error('Next level failed');}
  openLevel(entry.index);$('intro-reset').click();if(state!==map.initial)throw Error('Reset failed');
  result.won=true;result.animation=animated;
 }catch(e){result.error=e.stack;}results.push(result);}
 document.documentElement.setAttribute('data-qa-result',JSON.stringify({width:${width},viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector('main').getBoundingClientRect().width,results}));
},100);`;
 const html=template.replace('</body>',()=>script(boot)+files.map(f=>script(read(f))).join('')+script(qa)+'</body>');
 const file=output.replace(/\\/g,'/')+'/all-campaign-'+width+'-'+chapter+'.html';fs.writeFileSync(file,html);
 let result;try{result=await runBrowser(file,width,chapter);}catch(e){result={chapter,error:e.message};}
 all.push(result);if(result.error||result.results?.some(r=>r.error||r.issues.length||r.unsolved))process.exitCode=1;fs.writeFileSync(output.replace(/\\/g,'/')+'/all-campaign-ui-results-'+width+(only?'-'+only:'')+'.json',JSON.stringify(all,null,2));
 console.log(JSON.stringify({chapter,width,viewport:result.viewport,scrollWidth:result.scrollWidth,won:result.results?.filter(r=>r.won).length,count:result.results?.length,issues:result.results?.filter(r=>r.error||r.issues.length||r.unsolved),error:result.error}));
}
})().catch(e=>{console.error(e);process.exitCode=1;});
