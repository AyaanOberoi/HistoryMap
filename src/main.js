import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geoAlbersUsa } from 'd3-geo';
import { feature, mesh as topologyMesh } from 'topojson-client';

const stateNames = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California','08':'Colorado','09':'Connecticut','10':'Delaware','12':'Florida','13':'Georgia','15':'Hawaii','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi','29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire','34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina','38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania','44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin','56':'Wyoming'
};

const techCenters = [
  {name:'Seattle / Redmond',coordinates:[-122.1215,47.6740]},
  {name:'Silicon Valley',coordinates:[-122.1430,37.4419]},
  {name:'Los Angeles',coordinates:[-118.2437,34.0522]},
  {name:'San Diego',coordinates:[-117.1611,32.7157]},
  {name:'Austin',coordinates:[-97.7431,30.2672]},
  {name:'Denver / Boulder',coordinates:[-105.2705,40.0150]},
  {name:'Chicago',coordinates:[-87.6298,41.8781]},
  {name:'Atlanta',coordinates:[-84.3880,33.7490]},
  {name:'Research Triangle',coordinates:[-78.6382,35.7796]},
  {name:'Washington, D.C.',coordinates:[-77.0369,38.9072]},
  {name:'New York City',coordinates:[-74.0060,40.7128]},
  {name:'Boston / Cambridge',coordinates:[-71.1097,42.3736]}
];


const wrap = document.querySelector('#canvas-wrap');
const tooltip = document.querySelector('#tooltip');
const select = document.querySelector('#state-select');
const states = new Map(), pickables = [], labels = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const depth = .12;
const point = ([x,y], z=0) => new THREE.Vector3((x-480)*.015, -(y-300)*.015, z);
const projection = geoAlbersUsa().scale(1280).translate([480,300]);
let renderer, camera, controls, scene, hovered, transition, mapBounds;
let topDown = false;
let satelliteTexture = null;
let satelliteEnabled = false;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function shapeFor(rings) {
  const outer = rings[0].map(p => { const v = point(p); return new THREE.Vector2(v.x,v.y); });
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const ring of rings.slice(1)) {
    const pts = ring.map(p => { const v=point(p); return new THREE.Vector2(v.x,v.y); });
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  return shape;
}

function addGeographicUVs(geometry) {
  const positions=geometry.getAttribute('position');
  const uvs=geometry.getAttribute('uv');
  for(let i=0;i<positions.count;i++) {
    const projected=[positions.getX(i)/.015+480,-positions.getY(i)/.015+300];
    const geographic=projection.invert(projected);
    if(!geographic){uvs.setXY(i,.5,.5);continue;}
    let [longitude,latitude]=geographic;
    if(longitude>0)longitude-=360;
    uvs.setXY(i,THREE.MathUtils.clamp((longitude+180)/120,0,1),THREE.MathUtils.clamp((latitude-15)/57,0,1));
  }
  uvs.needsUpdate=true;
}

function neutralizeSatelliteWater(texture) {
  const source=texture.image;
  const canvas=document.createElement('canvas');
  canvas.width=source.naturalWidth||source.width;
  canvas.height=source.naturalHeight||source.height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(source,0,0,canvas.width,canvas.height);
  try{
    const image=context.getImageData(0,0,canvas.width,canvas.height);
    const pixels=image.data;
    for(let i=0;i<pixels.length;i+=4){
      const red=pixels[i],green=pixels[i+1],blue=pixels[i+2];
      // Esri ocean pixels are strongly blue/cyan. Clearing only that range
      // removes water trapped inside the simplified Census coastline.
      if(blue>70&&blue>red+18&&green>red*1.12){
        pixels[i+3]=0;
      }
    }
    context.putImageData(image,0,0);
    texture.image=canvas;
    texture.needsUpdate=true;
  }catch(error){
    console.warn('Satellite water-edge cleanup unavailable',error);
  }
  return texture;
}

function lineLayer(multiline,color,opacity,z) {
  const segments=[];
  for(const line of multiline.coordinates)for(let i=1;i<line.length;i++)segments.push(point(line[i-1],z),point(line[i],z));
  const layer=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segments),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
  layer.renderOrder=4;
  return layer;
}

function coastlineRibbon(multiline,width,color,z) {
  const triangles=[];
  const half=width/2;
  for(const line of multiline.coordinates)for(let i=1;i<line.length;i++){
    const a=point(line[i-1],z),b=point(line[i],z);
    const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
    if(!length)continue;
    const ox=-dy/length*half,oy=dx/length*half;
    triangles.push(
      a.x+ox,a.y+oy,z, a.x-ox,a.y-oy,z, b.x+ox,b.y+oy,z,
      b.x+ox,b.y+oy,z, a.x-ox,a.y-oy,z, b.x-ox,b.y-oy,z
    );
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(triangles,3));
  const material=new THREE.MeshBasicMaterial({color,transparent:true,opacity:.96,depthWrite:false,side:THREE.DoubleSide});
  const ribbon=new THREE.Mesh(geometry,material);
  ribbon.renderOrder=3;
  return ribbon;
}

function initialize() {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-10,10,7,-7,.1,150);
  // The map lies in XY, so orbit and top-down views must use Z as up.
  camera.up.set(0,0,1);
  camera.position.set(0,-13,22);
  renderer = new THREE.WebGLRenderer({antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1;
  document.querySelector('#map').appendChild(renderer.domElement);
  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.09;
  controls.minPolarAngle=.001;
  controls.maxPolarAngle=Math.PI*.42;
  controls.minZoom=.15; controls.maxZoom=8;
  controls.screenSpacePanning=true;
  controls.addEventListener('start',()=>{transition=null;clearHover();});
  scene.add(new THREE.AmbientLight('#f5f8f0',1.8));
  const sun=new THREE.DirectionalLight('#fff8e9',2.1);
  sun.position.set(-7,6,16); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-12,right:12,top:9,bottom:-9,near:1,far:45});
  sun.shadow.bias=-.00015;sun.shadow.normalBias=.02;sun.shadow.radius=3;
  scene.add(sun);
  const fill=new THREE.DirectionalLight('#d9e8e5',.7);
  fill.position.set(9,-5,8);scene.add(fill);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({opacity:.12}));
  ground.position.z=-.015;ground.receiveShadow=true;scene.add(ground);
  resize();
}

function addLabels() {
  for(const [id,name] of [['02','ALASKA'],['15','HAWAII']]) {
    const box=new THREE.Box3().setFromObject(states.get(id));
    const anchor=box.getCenter(new THREE.Vector3());
    anchor.y=box.min.y-.24;anchor.z=depth;
    const el=document.createElement('div');el.className='map-label';
    el.innerHTML=name+'<small>INSET</small>';
    document.querySelector('#labels').append(el);labels.push({el,anchor});
  }
}

function addTechCenters() {
  const dotMaterial=new THREE.MeshBasicMaterial({color:'#c44835'});
  const haloMaterial=new THREE.MeshBasicMaterial({color:'#fff0e7',transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false});
  for(const center of techCenters) {
    const projected=projection(center.coordinates);
    if(!projected)continue;
    const group=new THREE.Group();
    group.position.copy(point(projected,depth+.012));
    const halo=new THREE.Mesh(new THREE.RingGeometry(.085,.135,32),haloMaterial);
    halo.renderOrder=5;group.add(halo);
    const dot=new THREE.Mesh(new THREE.SphereGeometry(.075,20,14),dotMaterial);
    dot.position.z=.052;dot.renderOrder=6;
    dot.userData={type:'center',name:center.name,focus:group.position.clone()};
    group.add(dot);scene.add(group);pickables.push(dot);
  }
}

async function loadMap() {
  const response=await fetch('assets/states-albers-10m.json');
  if(!response.ok) throw new Error('Boundary data unavailable');
  const topology=await response.json();
  const features=feature(topology,topology.objects.states).features;
  const land=new THREE.Group();
  for(const f of features) {
    const id=String(f.id).padStart(2,'0');if(!stateNames[id])continue;
    const group=new THREE.Group();
    const top=new THREE.MeshStandardMaterial({color:'#b4c6b7',roughness:.87,metalness:0});
    // Keep the vertical wall unlit so cool scene lighting cannot turn the
    // raised coastline into a blue/cyan rim in satellite mode.
    const side=new THREE.MeshBasicMaterial({color:'#718b7b'});
    group.userData={id,material:top,sideMaterial:side};
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
    for(const rings of polygons) {
      // No bevel expansion: adjoining polygons keep their exact shared edge.
      const geometry=new THREE.ExtrudeGeometry(shapeFor(rings),{depth,bevelEnabled:false,steps:1,curveSegments:1});
      addGeographicUVs(geometry);
      const part=new THREE.Mesh(geometry,[top,side]);
      part.castShadow=true;part.receiveShadow=true;part.userData={type:'state',id};
      group.add(part);pickables.push(part);
    }
    states.set(id,group);land.add(group);
  }
  if(states.size!==50)throw new Error('Expected all 50 states');
  scene.add(land);mapBounds=new THREE.Box3().setFromObject(land);
  // TopoJSON shared arcs provide one authoritative edge for both adjoining states.
  const interiors=topologyMesh(topology,topology.objects.states,(a,b)=>a!==b);
  scene.add(lineLayer(interiors,'#647c6b',.72,depth+.003));
  const coast=topologyMesh(topology,topology.objects.nation);
  // A narrow solid edge masks ocean pixels where imagery and the simplified
  // coastline differ by a few pixels, while preserving the authoritative arc.
  scene.add(coastlineRibbon(coast,.055,'#263b34',depth+.004));
  scene.add(lineLayer(coast,'#315848',.9,depth+.006));
  addTechCenters();addLabels();reset(false);
  document.querySelector('#loading').hidden=true;
  bindPointer();
}

function fitZoom(box) {
  const size=box.getSize(new THREE.Vector3());
  const horizontal=(camera.right-camera.left)/(size.x*1.2);
  const vertical=(camera.top-camera.bottom)/(size.y*1.5);
  return Math.min(horizontal,vertical,7);
}
function move(target,zoom,animate=true) {
  const offset=topDown?new THREE.Vector3(0,-.02,26):new THREE.Vector3(0,-13,22);
  const position=target.clone().add(offset);
  if(!animate||reducedMotion) {
    transition=null;camera.position.copy(position);controls.target.copy(target);camera.zoom=zoom;camera.updateProjectionMatrix();controls.update();return;
  }
  transition={start:performance.now(),from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),targetTo:target,zoomFrom:camera.zoom,zoomTo:zoom};
}
function reset(animate=true) {
  if(!mapBounds)return;
  select.value='';topDown=false;
  document.querySelector('#selection').textContent='All 50 states shown. Choose a state to focus the map.';
  document.querySelector('#top-view').setAttribute('aria-pressed','false');
  move(mapBounds.getCenter(new THREE.Vector3()),fitZoom(mapBounds),animate);
}
function focusState(id) {
  if(!states.has(id))return;
  const box=new THREE.Box3().setFromObject(states.get(id));
  move(box.getCenter(new THREE.Vector3()),Math.min(fitZoom(box),6));
  select.value=id;
  document.querySelector('#selection').textContent='Focused on '+stateNames[id];
}
function clearHover() {
  if(hovered?.userData.type==='state')states.get(hovered.userData.id).userData.material.color.set(satelliteEnabled?'#ffffff':'#b4c6b7');
  if(hovered?.userData.type==='center')hovered.parent.scale.setScalar(1);
  hovered=null;tooltip.classList.remove('visible');
}
function hit(event) {
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  return raycaster.intersectObjects(pickables,false)[0]?.object || null;
}
function bindPointer() {
  let down=null,dragging=false;
  const canvas=renderer.domElement;
  canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};dragging=false;});
  canvas.addEventListener('pointermove',e=>{
    if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)dragging=true;
    if(e.buttons||e.pointerType==='touch'){clearHover();return;}
    const target=hit(e);
    if(target!==hovered){clearHover();if(target){hovered=target;if(target.userData.type==='state')states.get(target.userData.id).userData.material.color.set(satelliteEnabled?'#c9e8d4':'#93b2a0');else target.parent.scale.setScalar(1.45);}}
    if(target){tooltip.textContent=target.userData.type==='state'?stateNames[target.userData.id]:target.userData.name;tooltip.style.left=e.clientX+'px';tooltip.style.top=e.clientY+'px';tooltip.classList.add('visible');}
  });
  canvas.addEventListener('pointerup',e=>{if(down&&!dragging){const target=hit(e);if(target?.userData.type==='state')focusState(target.userData.id);if(target?.userData.type==='center'){move(target.userData.focus.clone(),3.8);document.querySelector('#selection').textContent='Focused on '+target.userData.name;}}down=null;});
  canvas.addEventListener('pointercancel',()=>{down=null;clearHover();});
  canvas.addEventListener('pointerleave',clearHover);
}
function resize() {
  if(!renderer)return;
  const aspect=wrap.clientWidth/wrap.clientHeight, halfHeight=7;
  camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;
  camera.top=halfHeight;camera.bottom=-halfHeight;
  camera.updateProjectionMatrix();renderer.setSize(wrap.clientWidth,wrap.clientHeight);
  if(mapBounds)reset(false);
}
function tick(now) {
  requestAnimationFrame(tick);
  if(transition){
    const a=transition,t=Math.min(1,(now-a.start)/700),s=t*t*(3-2*t);
    camera.position.lerpVectors(a.from,a.to,s);controls.target.lerpVectors(a.targetFrom,a.targetTo,s);
    camera.zoom=THREE.MathUtils.lerp(a.zoomFrom,a.zoomTo,s);camera.updateProjectionMatrix();
    if(t===1)transition=null;
  }
  controls.update();camera.updateMatrixWorld();
  for(const {el,anchor} of labels) {
    const p=anchor.clone().project(camera);
    el.style.left=((p.x+1)*wrap.clientWidth/2)+'px';el.style.top=((-p.y+1)*wrap.clientHeight/2)+'px';
    el.hidden=Math.abs(p.x)>1||Math.abs(p.y)>1||p.z>1;
  }
  renderer.render(scene,camera);
}
Object.entries(stateNames).sort((a,b)=>a[1].localeCompare(b[1])).forEach(([id,name])=>select.add(new Option(name,id)));
select.addEventListener('change',()=>select.value?focusState(select.value):reset());
document.querySelector('#reset-view').addEventListener('click',()=>reset());
document.querySelector('#top-view').addEventListener('click',()=>{
  topDown=!topDown;document.querySelector('#top-view').setAttribute('aria-pressed',String(topDown));
  move(controls.target.clone(),camera.zoom);
});
document.querySelector('#satellite-view').addEventListener('click',async event=>{
  const button=event.currentTarget;
  if(!satelliteTexture){
    button.disabled=true;button.querySelector('span').textContent='Loading…';
    try{
      const url='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-180,15,-60,72&bboxSR=4326&imageSR=4326&size=2048,1024&format=jpg&f=image';
      satelliteTexture=await new THREE.TextureLoader().loadAsync(url);
      neutralizeSatelliteWater(satelliteTexture);
      satelliteTexture.colorSpace=THREE.SRGBColorSpace;
      // Mipmaps blend nearby ocean pixels into the cut coastline. Linear
      // filtering keeps the imagery crisp without creating a blue halo.
      satelliteTexture.generateMipmaps=false;
      satelliteTexture.minFilter=THREE.LinearFilter;
      satelliteTexture.magFilter=THREE.LinearFilter;
      satelliteTexture.anisotropy=renderer.capabilities.getMaxAnisotropy();
    }catch(error){console.error('Satellite layer unavailable',error);button.title='Satellite imagery could not load';button.disabled=false;button.querySelector('span').textContent='Satellite';return;}
    button.disabled=false;button.querySelector('span').textContent='Satellite';
  }
  satelliteEnabled=!satelliteEnabled;
  for(const state of states.values()){
    const material=state.userData.material;
    const sideMaterial=state.userData.sideMaterial;
    material.map=satelliteEnabled?satelliteTexture:null;
    material.color.set(satelliteEnabled?'#ffffff':'#b4c6b7');
    material.roughness=satelliteEnabled ? .94 : .87;
    material.alphaTest=satelliteEnabled ? .5 : 0;
    material.needsUpdate=true;
    sideMaterial.color.set(satelliteEnabled?'#1d2421':'#718b7b');
    sideMaterial.needsUpdate=true;
  }
  button.setAttribute('aria-pressed',String(satelliteEnabled));
  button.title=satelliteEnabled?'Show neutral map':'Show satellite imagery';
  document.querySelector('#imagery-credit').hidden=!satelliteEnabled;
});
for(const [id,factor] of [['zoom-in',1.3],['zoom-out',1/1.3]])document.querySelector('#'+id).addEventListener('click',()=>move(controls.target.clone(),THREE.MathUtils.clamp(camera.zoom*factor,.15,8)));
const present=document.querySelector('#present-button');
present.addEventListener('click',()=>{
  const active=document.body.classList.toggle('presentation');present.textContent=active?'Show controls':'Hide controls';present.setAttribute('aria-pressed',String(active));
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('presentation'))present.click();});
async function start() {
  try {initialize();await loadMap();requestAnimationFrame(tick);new ResizeObserver(resize).observe(wrap);}
  catch(error){console.error(error);document.querySelector('#loading').hidden=true;document.querySelector('#load-error').hidden=false;}
}
start();
