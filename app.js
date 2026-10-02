import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colors = {C:'#a78bfa',O:'#ff796b',N:'#67dfea',Cl:'#d4ed7b',Br:'#eaaa72',H:'#eee9fa'};
const names = {C:'Carbon',O:'Oxygen',N:'Nitrogen',Cl:'Chlorine',Br:'Bromine',H:'Hydrogen'};
const problemNames = ['Stereochemistry','Fischer forms','Chair lab','Fused rings','Resonance','Stability','Chair → flat','Chirality','Acid reactions'];
let data, current, stateIndex=0, showH=false, showStereo=true, spacefill=false, orbitals=false, axisIndex=0, renderer, scene, camera, controls, molecule, modelMeshes=[],bondMeshes=[],labelNodes=[],flowGroup, flowDots=[], tween=null;
let selectedAtom=null;
let visited = new Set();
try { visited = new Set(JSON.parse(localStorage.getItem('orbital.visited')||'[]')); } catch {}
const stage=$('stage');
const sphereGeo=new THREE.SphereGeometry(1,32,24);
const cylinderGeo=new THREE.CylinderGeometry(1,1,1,12);
const materials={};
let resizeObserver;

function setup3D(){
 try {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  stage.prepend(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(35,1,.1,200);camera.up.set(0,0,1);
  const pmrem=new THREE.PMREMGenerator(renderer);const room=new RoomEnvironment();
  scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
  scene.add(new THREE.AmbientLight(0xc5b4ef,1));
  for(const [p,c,power] of [[[3,-4,8],0xffeaff,100],[[-6,0,2],0x8ee2c0,65],[[3,6,3],0xe8b0ff,80]]){
   const l=new THREE.PointLight(c,power,40);l.position.set(...p);scene.add(l);
  }
  for(const [e,c] of Object.entries(colors))materials[e]=new THREE.MeshPhysicalMaterial({color:c,roughness:.24,metalness:.23,clearcoat:1,clearcoatRoughness:.14});
  materials.bond=new THREE.MeshStandardMaterial({color:0x7b6b93,roughness:.28,metalness:.5});
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.minDistance=3;controls.maxDistance=40;controls.enablePan=true;controls.autoRotateSpeed=.65;
  resizeObserver=new ResizeObserver(()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();if(current)resetView();});resizeObserver.observe(stage);
  let down;
  renderer.domElement.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY});
  renderer.domElement.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5)pickAtom(e);down=null;});
  stage.addEventListener('keydown',e=>{
   const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'];if(!keys.includes(e.key))return;e.preventDefault();
   const offset=camera.position.clone().sub(controls.target);
   if(e.key==='+'||e.key==='=')offset.multiplyScalar(.88);else if(e.key==='-')offset.multiplyScalar(1.12);
   else{const axis=['ArrowLeft','ArrowRight'].includes(e.key)?new THREE.Vector3(0,0,1):new THREE.Vector3().crossVectors(offset,camera.up).normalize();offset.applyAxisAngle(axis,['ArrowLeft','ArrowUp'].includes(e.key)?.15:-.15);}
   camera.position.copy(controls.target).add(offset);controls.update();
  });
  animate();
 } catch(e) { console.warn('WebGL unavailable:',e.message);$('webgl-error').hidden=false; }
}

function getState(){return current.states[stateIndex];}
function point(i,state=getState()){return new THREE.Vector3(...state.atoms[i].p);}
function midpoint(indices,state=getState()){return indices.reduce((v,i)=>v.add(point(i,state)),new THREE.Vector3()).divideScalar(indices.length);}
function radius(e){return (spacefill?{H:.42,C:.72,O:.65,N:.67,Cl:.8,Br:.87}:{H:.16,C:.3,O:.31,N:.31,Cl:.38,Br:.4})[e]||.3;}
function clearLabels(){for(const l of labelNodes){l.el.remove();l.line.remove();}labelNodes=[];}
function addLabel(i,text,charge=false){
 const el=document.createElement('span');el.className='atom-label'+(charge?' charge':'');el.textContent=text;el.hidden=true;el.dataset.atom=String(i);$('labels').append(el);
 const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.dataset.atom=String(i);line.style.display='none';$('label-lines').append(line);
 labelNodes.push({i,el,line,slot:0,charge});
}
function updateLabels(){
 const w=stage.clientWidth,h=stage.clientHeight,placed=[];
 const up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion);
 for(const label of labelNodes){
  const {el,line,i,charge}=label,m=modelMeshes.find(m=>m.userData.atom===i);
  if(!m){el.hidden=true;line.style.display='none';continue;}
  const p=m.position.clone().project(camera);
  if(p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1){el.hidden=true;line.style.display='none';continue;}
  const x=(p.x*.5+.5)*w,y=(-p.y*.5+.5)*h;
  const edge=m.position.clone().addScaledVector(up,m.scale.x).project(camera);
  const distance=Math.abs(edge.y-p.y)*h*.5+19;
  const offsets=[[0,-distance],[distance+5,0],[-distance-5,0],[0,distance],[distance,-distance],[-distance,-distance],[distance,distance],[-distance,distance],[0,-distance-32],[0,distance+32]];
  const width=charge?35:27,height=25;
  const order=[label.slot,...offsets.map((_,i)=>i).filter(i=>i!==label.slot)];
  let chosen;
  for(const slot of order){
   const [dx,dy]=offsets[slot],cx=Math.max(width/2+5,Math.min(w-width/2-5,x+dx)),cy=Math.max(height/2+5,Math.min(h-height/2-5,y+dy));
   const box={x:cx,y:cy,w:width,h:height};
   if(!placed.some(b=>Math.abs(b.x-cx)<(b.w+width)/2+6&&Math.abs(b.y-cy)<(b.h+height)/2+6)){chosen=box;label.slot=slot;break;}
  }
  if(!chosen){el.hidden=true;line.style.display='none';continue;}
  placed.push(chosen);el.hidden=false;el.style.left=`${chosen.x}px`;el.style.top=`${chosen.y}px`;
  line.style.display='';line.setAttribute('x1',x);line.setAttribute('y1',y);line.setAttribute('x2',chosen.x);line.setAttribute('y2',chosen.y);
 }
}
function rebuild(){
 if(!scene)return;
 if(molecule){molecule.traverse(o=>{if(o.userData.orbital)o.material.dispose();});scene.remove(molecule);}if(flowGroup)disposeFlow();
 molecule=new THREE.Group();scene.add(molecule);modelMeshes=[];bondMeshes=[];clearLabels();
 const s=getState();
 for(const [i,a] of s.atoms.entries()){
  if(a.e==='H'&&!showH)continue;
  const mesh=new THREE.Mesh(sphereGeo,materials[a.e]||materials.C);mesh.position.set(...a.p);mesh.scale.setScalar(radius(a.e));mesh.userData.atom=i;molecule.add(mesh);modelMeshes.push(mesh);
  if(a.q)addLabel(i,`${a.e}${a.q>0?'+':'−'}`,true);
  else if(a.cip&&showStereo)addLabel(i,a.cip);
 }
 for(const [a,b,order] of s.bonds){
  if(!showH&&(s.atoms[a].e==='H'||s.atoms[b].e==='H'))continue;
  const n=order===1.5?2:Math.round(order);
  for(let k=0;k<n;k++){
   const mesh=new THREE.Mesh(cylinderGeo,materials.bond);mesh.userData={a,b,shift:(k-(n-1)/2)*.14};molecule.add(mesh);bondMeshes.push(mesh);
  }
 }
 updateBonds();if(orbitals)addOrbitals();addElectronFlow();
}
function updateBonds(){
 const s=getState();
 for(const mesh of bondMeshes){
  const {a,b,shift}=mesh.userData;const ma=modelMeshes.find(m=>m.userData.atom===a),mb=modelMeshes.find(m=>m.userData.atom===b);
  const pa=ma?.position||point(a,s),pb=mb?.position||point(b,s);const direction=pb.clone().sub(pa);
  let perpendicular=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,0,1));if(perpendicular.length()<.01)perpendicular.crossVectors(direction,new THREE.Vector3(0,1,0));perpendicular.normalize().multiplyScalar(shift);
  mesh.position.copy(pa).add(pb).multiplyScalar(.5).add(perpendicular);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());mesh.scale.set(.065,direction.length(),.065);
 }
}
function addOrbitals(){
 const s=getState();
 const ids=new Set(s.bonds.filter(b=>b[2]>1).flatMap(b=>b.slice(0,2)));s.atoms.forEach((a,i)=>{if(a.q)ids.add(i);});
 for(const i of ids)for(const sign of [-1,1]){
  const material=new THREE.MeshBasicMaterial({color:sign>0?0x9e8cf1:0x8ee2c0,transparent:true,opacity:.18,depthWrite:false});
  const lobe=new THREE.Mesh(sphereGeo,material);lobe.position.copy(point(i)).add(new THREE.Vector3(0,0,sign*.53));lobe.scale.set(.27,.27,.58);lobe.userData.orbital=true;molecule.add(lobe);
 }
}
function disposeFlow(){if(!flowGroup)return;scene.remove(flowGroup);flowGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});flowGroup=null;flowDots=[];}
function addElectronFlow(){
 const s=getState();if(!s.arrows?.length)return;
 flowGroup=new THREE.Group();scene.add(flowGroup);flowDots=[];
 for(const arrow of s.arrows){
  const start=midpoint(arrow.from),end=midpoint(arrow.to);start.z+=.58;end.z+=.58;
  const delta=end.clone().sub(start);const side=new THREE.Vector3(-delta.y,delta.x,0).normalize().multiplyScalar(.7);
  const control=start.clone().add(end).multiplyScalar(.5).add(side);control.z+=.35;
  const curve=new THREE.QuadraticBezierCurve3(start,control,end);
  const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,28,.025,6,false),new THREE.MeshBasicMaterial({color:0xd4ed7b}));flowGroup.add(tube);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(.085,.22,12),new THREE.MeshBasicMaterial({color:0xd4ed7b}));cone.position.copy(end);cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangent(1).normalize());flowGroup.add(cone);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8),new THREE.MeshBasicMaterial({color:0xffffff}));flowGroup.add(dot);flowDots.push({curve,dot});
 }
}
function resetView(){if(!camera)return;const s=getState();const max=Math.max(...s.atoms.filter(a=>a.e!=='H').map(a=>Math.hypot(...a.p)));const halfFov=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));const distance=Math.max(8,(max+.45)/Math.sin(halfFov)*1.08)*(camera.aspect>=1.5?.82:1);controls.target.set(0,0,0);camera.position.copy(new THREE.Vector3(.6,-.9,.75).normalize().multiplyScalar(distance));camera.up.set(0,0,1);controls.update();}
function animate(time=0){
 requestAnimationFrame(animate);if(document.hidden)return;
 if(tween){const p=Math.min((time-tween.start)/tween.duration,1);const t=p*p*(3-2*p);for(const m of modelMeshes){const i=m.userData.atom;m.position.lerpVectors(tween.from[i],tween.to[i],t);}updateBonds();if(p===1)tween=null;}
 // The camera and labels must use the same frame, including damping and auto-spin.
 controls?.update();camera?.updateMatrixWorld();if(current)updateLabels();
 if(!reduced)for(const {dot,curve} of flowDots)dot.position.copy(curve.getPoint((time*.0004)%1));
 renderer?.render(scene,camera);
}
function pickAtom(e){
 const rect=renderer.domElement.getBoundingClientRect();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
 const hit=ray.intersectObjects(modelMeshes)[0];if(!hit)return;const i=hit.object.userData.atom;selectedAtom=i;const a=getState().atoms[i];
 $('atom-info').textContent=`${names[a.e]} ${i+1}${a.cip?` · ${a.cip}`:''}${a.q?` · ${a.q>0?'+':''}${a.q}`:''}`;
}
function setState(index){
 const prev=getState();stateIndex=index;selectedAtom=null;$('atom-info').textContent='';
 const next=getState();rebuild();
 if(scene&&!reduced&&current.kind==='chair'&&index<2&&prev.atoms.length===next.atoms.length){tween={from:prev.atoms.map(a=>new THREE.Vector3(...a.p)),to:next.atoms.map(a=>new THREE.Vector3(...a.p)),start:performance.now(),duration:750};}
 else tween=null;
 renderStateControls();renderProjection();
 if(current.kind==='acid')resetView();
}
function button(text,fn,active=false){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;if(active)b.classList.add('active');b.setAttribute('aria-pressed',String(active));return b;}
function selectScene(id,scroll=false){
 current=data.find(s=>s.id===id)||data[0];stateIndex=0;axisIndex=0;orbitals=false;tween=null;
 document.documentElement.style.setProperty('--accent',['#d4ed7b','#f5bca5','#c5b2eb','#8ee2c0'][Math.floor((current.problem-1)/2)%4]);
 visited.add(current.id);try{localStorage.setItem('orbital.visited',JSON.stringify([...visited]));}catch{}
 $('visited-count').textContent=data.filter(s=>visited.has(s.id)).length;
 $('part-tag').textContent=`${String(current.problem).padStart(2,'0')} / ${current.id.slice(1).toUpperCase()||'ALL'}`;
 $('scene-title').textContent=current.title;$('task').textContent=current.task;$('takeaway').textContent=current.takeaway;
 $('formula').innerHTML=current.formula.replace(/(\d+)/g,'<sub>$1</sub>');$('center-count').textContent=['resonance','acid','decalin'].includes(current.kind)?'—':current.centers;
 $('isomer-count').textContent=current.isomers??current.states.length;$('isomer-label').textContent=current.isomers?'stereoisomers':'model states';
 $('model-note').textContent=['resonance','acid'].includes(current.kind)?'Resonance contributors share one nuclear framework. Electron arrows refer to the indicated parent contributor; they do not show molecules changing back and forth in time.':current.kind==='chair'?'Idealized teaching geometry. Chair animations illustrate axial/equatorial exchange, not the physical transition pathway. Comparisons use qualitative steric penalties.':'Molecular conformations are models, not crystal structures. R/S describes configuration; rotating the camera does not change it.';
 $('part-tabs').replaceChildren(...data.filter(s=>s.problem===current.problem).map(s=>button(s.id.slice(1).toUpperCase()||'ALL',()=>navigate(s.id),s.id===current.id)));
 document.querySelectorAll('.problem-nav button').forEach((b,i)=>{b.classList.toggle('active',i+1===current.problem);b.setAttribute('aria-pressed',String(i+1===current.problem));});
 $('atom-info').textContent='';rebuild();resetView();renderStateControls();renderProjection();
 if(scroll)$('playground').scrollIntoView({behavior:reduced?'instant':'smooth'});
 document.title=`PS3 ${current.id.toUpperCase()} · ${current.title} — Orbital`;
}
function navigate(id){location.hash=`p=${id}`;}
function renderStateControls(){
 const s=getState();$('formula').innerHTML=(s.formula||current.formula).replace(/(\d+)/g,'<sub>$1</sub>');

 $('state-buttons').replaceChildren(...current.states.map((v,i)=>{const short=v.label.replace('As drawn','Original').replace('Flipped chair','Flip').replace('Mirror image','Mirror').replace(/^Neutral .*/, 'Neutral').replace(/^(Protonated|Imidazolium) · contributor /,'H⁺ · ').replace('Contributor ','').replace('Chair A','Chair');const b=button(short,()=>setState(i),i===stateIndex);b.title=v.label;b.setAttribute('aria-label',v.label);return b;}));
 $('special-controls').replaceChildren();
 if(current.axes){current.axes.forEach(([a,b],i)=>$('special-controls').append(button(`Newman ${a+1} → ${b+1}`,()=>{axisIndex=i;alignAxis(a,b);$('projection-panel').open=true;renderProjection();},false)));$('special-controls').append(button('Free view',resetView));}
 if(['resonance','acid'].includes(current.kind))$('special-controls').append(button('p orbitals',()=>{orbitals=!orbitals;rebuild();renderStateControls();},orbitals));
 if(current.kind==='decalin')$('special-controls').append(button('Bridgehead H',()=>{showH=!showH;$('hydrogens').setAttribute('aria-pressed',String(showH));rebuild();renderStateControls();}));
 const detail=$('state-detail');detail.replaceChildren();
 if(s.substituents){for(const sub of s.substituents){const span=document.createElement('span');span.className=sub.position;span.textContent=`${sub.group} ${sub.position==='axial'?'ax':'eq'} ${sub.side==='up'?'↑':'↓'}`;detail.append(span);}if(stateIndex<2){const preferred=current.states[0].strain<=current.states[1].strain?0:1;const p=document.createElement('div');p.textContent=stateIndex===preferred?'Lower strain':'Higher strain';detail.append(p);}}
 else if(current.kind==='resonance'||current.kind==='acid'){
  const charge=s.atoms.reduce((n,a)=>n+a.q,0);detail.textContent=`Charge ${charge>0?'+':''}${charge}`;
  if(s.parent!=null)detail.textContent+=` · ${s.parent+1} → ${stateIndex+(current.kind==='acid'?0:1)}`;
  if(current.acidNote&&stateIndex>0)detail.textContent+=' · illustrative pathway';
 }else if(current.kind==='decalin')detail.textContent=s.label.startsWith('trans')?'Locked':'Flexible';
 else detail.textContent=current.kind==='fischer'?(stateIndex===2?'Meso':'Enantiomers'):'';
}
function alignAxis(a,b){if(!camera)return;const front=point(a),back=point(b);const dir=front.clone().sub(back).normalize();controls.target.copy(front.clone().add(back).multiplyScalar(.5));camera.position.copy(controls.target).addScaledVector(dir,10);camera.up.set(0,0,1);if(Math.abs(dir.z)>.95)camera.up.set(0,1,0);controls.update();}

// Projections are derived from each molecular graph or the explicitly transcribed faces.
const svgStart=(w=420,h=190)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${current.title}: molecular projection"><defs><marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#d4ed7b"/></marker></defs>`;
const txt=(x,y,t,color='#e5ddee',size=12)=>`<text x="${x}" y="${y}" text-anchor="middle" fill="${color}" font-family="Space,Arial,sans-serif" font-size="${size}">${t}</text>`;
const line=(x,y,a,b,color='#8e7d9f',width=2,dash='')=>`<line x1="${x}" y1="${y}" x2="${a}" y2="${b}" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
function renderProjection(){
 const s=getState();let svg=svgStart();
 if(current.kind==='fischer'){
  $('projection-label').textContent='FISCHER PROJECTION';
  const left=stateIndex===0?['OH','H']:stateIndex===1?['H','OH']:['OH','OH'];
  svg+=line(210,35,210,155)+line(165,70,255,70)+line(165,120,255,120);
  svg+=txt(210,23,'CH₃')+txt(210,177,'CH₃');
  for(let j=0;j<2;j++){svg+=txt(148,74+j*50,left[j],left[j]==='OH'?colors.O:'#cbc1d7')+txt(276,74+j*50,left[j]==='OH'?'H':'OH',left[j]==='H'?colors.O:'#cbc1d7');}
  $('projection-note').textContent='Horizontal bonds point toward you. Vertical bonds point away. A 180° rotation in the page preserves the Fischer configuration.';
 }else if(current.axes){
  const [a,b]=current.axes[axisIndex];$('projection-label').textContent=`NEWMAN VIEW · ${a+1} IN FRONT → ${b+1} BEHIND`;
  const front=point(a),back=point(b),axis=back.clone().sub(front).normalize();let u=new THREE.Vector3().crossVectors(axis,new THREE.Vector3(0,0,1));if(u.length()<.01)u.crossVectors(axis,new THREE.Vector3(0,1,0));u.normalize();const v=new THREE.Vector3().crossVectors(u,axis).normalize();
  svg+='<circle cx="210" cy="93" r="29" stroke="#bfa4ee" stroke-width="2" fill="none"/>';
  for(const [atom,isFront] of [[b,false],[a,true]])for(const bond of s.bonds){if(!bond.slice(0,2).includes(atom))continue;const n=bond[0]===atom?bond[1]:bond[0];if(n===a||n===b)continue;const delta=point(n).sub(point(atom));const angle=Math.atan2(delta.dot(v),delta.dot(u));const x=Math.cos(angle),y=-Math.sin(angle);const start=isFront?0:29;const end=isFront?61:67;svg+=line(210+x*start,93+y*start,210+x*end,93+y*end,isFront?'#d4ed7b':'#bfa4ee',2.4);svg+=txt(210+x*86,97+y*81,s.atoms[n].e+(s.atoms[n].e==='H'?'':n+1),isFront?'#d4ed7b':'#c8b0ef',10);}
  svg+='<circle cx="210" cy="93" r="5" fill="#d4ed7b"/>'+txt(56,83,`FRONT ${a+1}`,'#d4ed7b',9)+txt(56,101,`BACK ${b+1}`,'#bfa4ee',9);
  $('projection-note').textContent='The front carbon is the dot; the back carbon is the circle. Labels name the directly attached atom. Use the matching Newman button to align the 3D camera.';
  // For problem 7 the flat ring directly addresses the chair-to-hexagon conversion.
  if(current.problem===7)svg=flatRing(s);
 }else if(s.ring){svg=flatRing(s);
 }else{
  $('projection-label').textContent=['resonance','acid'].includes(current.kind)?'ELECTRON MAP':'CONNECTIVITY MAP';
  // Electron arrows apply to the parent contributor, so show that structure under the arrows.
  let source=s;
  if(s.parent!=null)source=current.states[s.parent+(current.kind==='acid'?1:0)];
  const heavy=source.atoms.map((a,i)=>a.e!=='H'?i:-1).filter(i=>i>=0);const pts=source.layout;
  const xs=heavy.map(i=>pts[i][0]),ys=heavy.map(i=>pts[i][1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const scale=Math.min(320/(maxX-minX||1),118/(maxY-minY||1));
  const pos=i=>[210+(pts[i][0]-(minX+maxX)/2)*scale,96-(pts[i][1]-(minY+maxY)/2)*scale];
  for(const [a,b,order] of source.bonds){if(!heavy.includes(a)||!heavy.includes(b))continue;const A=pos(a),B=pos(b);const n=order===1.5?2:Math.round(order);const dx=B[0]-A[0],dy=B[1]-A[1],norm=Math.hypot(dx,dy)||1;
   for(let k=0;k<n;k++){const off=(k-(n-1)/2)*4;svg+=line(A[0]-dy/norm*off,A[1]+dx/norm*off,B[0]-dy/norm*off,B[1]+dx/norm*off,'#8e7d9f',1.7,order===1.5&&k===1?'3 3':'');}
  }
  for(const i of heavy){const a=source.atoms[i],[x,y]=pos(i);svg+=`<circle cx="${x}" cy="${y}" r="10" fill="#1b1721"/>`+txt(x,y+4,a.e==='C'?String(i+1):a.e+(a.q>0?'+':a.q<0?'−':''),colors[a.e],a.e==='C'?9:12);if(a.q&&a.e==='C')svg+=txt(x+11,y-8,a.q>0?'+':'−','#d4ed7b',13);}
  if(s.arrows)for(const ar of s.arrows){const avg=ids=>ids.reduce((a,i)=>{const p=pos(i);return[a[0]+p[0]/ids.length,a[1]+p[1]/ids.length];},[0,0]);const A=avg(ar.from),B=avg(ar.to),dx=B[0]-A[0],dy=B[1]-A[1],len=Math.hypot(dx,dy)||1;svg+=`<path d="M${A[0]},${A[1]} Q${(A[0]+B[0])/2-dy/len*35},${(A[1]+B[1])/2+dx/len*35} ${B[0]},${B[1]}" stroke="#d4ed7b" fill="none" stroke-width="2" marker-end="url(#arrowhead)"/>`;}
  if(current.kind==='acid'&&stateIndex===0){svg+=txt(345,24,'H — Cl','#d4ed7b',14);const P=current.id==='9b'?pos(1):[ (pos(6)[0]+pos(7)[0])/2, (pos(6)[1]+pos(7)[1])/2 ];svg+=`<path d="M${P[0]},${P[1]-10} Q250,-8 329,20" fill="none" stroke="#d4ed7b" stroke-width="2" marker-end="url(#arrowhead)"/><path d="M350,22 Q363,0 374,20" fill="none" stroke="#d4ed7b" stroke-width="2" marker-end="url(#arrowhead)"/>`;}
  $('projection-note').textContent=s.parent!=null?`Electron flow shown on contributor ${s.parent+1}; the 3D view shows the resulting contributor. Arrows start at electron pairs and end at their new location.`:current.kind==='acid'&&stateIndex===0?'Proton transfer: an electron pair attacks H; the H–Cl bond pair goes to Cl. Select a protonated state to explore the resulting charge.':'Heavy-atom connectivity. Numbers match the viewer. Multiple lines are multiple bonds; a dashed second line marks an aromatic bond.';
 }
 $('projection').innerHTML=svg+'</svg>';
}
function flatRing(s){
 $('projection-label').textContent='FLAT RING · KEEP THE UP/DOWN FACES';let out=svgStart();const p=i=>[210+(s.reflected?-1:1)*Math.cos(Math.PI/2-i*Math.PI/3)*49,93-Math.sin(Math.PI/2-i*Math.PI/3)*49];
 for(let i=0;i<6;i++){const A=p(i),B=p((i+1)%6);out+=line(...A,...B);out+=txt(A[0],A[1]+4,s.atoms[i].e==='O'?'O':i+1,s.atoms[i].e==='O'?colors.O:'#b8a7cc',9);}
 for(const sub of s.substituents){const A=p(sub.atom),d=[A[0]-210,A[1]-93],B=[A[0]+d[0]*.55,A[1]+d[1]*.55];if(sub.side==='up'){const len=Math.hypot(...d);out+=`<path d="M${A[0]},${A[1]} L${B[0]-d[1]/len*4},${B[1]+d[0]/len*4} L${B[0]+d[1]/len*4},${B[1]-d[0]/len*4}Z" fill="#d4ed7b"/>`;}else out+=line(...A,...B,'#b59af8',3,'2 3');out+=txt(210+d[0]*1.85,97+d[1]*1.7,sub.group,sub.side==='up'?'#d4ed7b':'#b59af8',11);}
 $('projection-note').textContent='Solid wedge = up/toward you. Dashed bond = down/away. Flipping the chair never changes these faces. Viewer IDs follow the ring, not IUPAC numbering.';return out;
}

$('hydrogens').onclick=()=>{showH=!showH;$('hydrogens').setAttribute('aria-pressed',String(showH));rebuild();};
$('stereo-labels').onclick=()=>{showStereo=!showStereo;$('stereo-labels').setAttribute('aria-pressed',String(showStereo));rebuild();};
$('spacefill').onclick=()=>{spacefill=!spacefill;$('spacefill').setAttribute('aria-pressed',String(spacefill));rebuild();};
$('auto-rotate').onclick=()=>{if(!controls)return;controls.autoRotate=!controls.autoRotate;$('auto-rotate').setAttribute('aria-pressed',String(controls.autoRotate));};
$('reset-view').onclick=resetView;
$('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.querySelector('.experiment').requestFullscreen?.().catch(()=>{});};
$('next-scene').onclick=()=>navigate(data[(data.indexOf(current)+1)%data.length].id);
window.addEventListener('hashchange',()=>{const m=location.hash.match(/^#p=([1-9][a-d]?)$/);if(m)selectScene(m[1],true);});
try{
 const response=await fetch('./assets/molecules.json');if(!response.ok)throw new Error(`Molecular data returned ${response.status}`);data=await response.json();
 document.querySelector('.problem-nav').replaceChildren(...problemNames.map((n,i)=>{const b=button('',()=>navigate(data.find(s=>s.problem===i+1).id));b.innerHTML=`<strong>${String(i+1).padStart(2,'0')}</strong><span>${n}</span>`;b.setAttribute('aria-label',`Problem ${i+1}: ${n}`);return b;}));
 setup3D();selectScene(location.hash.match(/^#p=([1-9][a-d]?)$/)?.[1]||'1a');$('loading').hidden=true;
 // Lightweight public state for browser checks; never holds student information.
 window.orbital={get current(){return current.id;},get state(){return stateIndex;},get atoms(){return modelMeshes.length;},get sceneCount(){return data.length;},get webgl(){return !!renderer;},get labelAnchors(){return modelMeshes.filter(m=>labelNodes.some(l=>l.i===m.userData.atom)).map(m=>{const p=m.getWorldPosition(new THREE.Vector3()).project(camera);return {i:m.userData.atom,x:(p.x*.5+.5)*stage.clientWidth,y:(-p.y*.5+.5)*stage.clientHeight};});}};
}catch(error){$('loading').textContent='Could not load the molecules. Please reload the page.';console.error(error);}
