import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { geoAlbersUsa } from 'd3-geo';
import { feature } from 'topojson-client';

const stateNames = {
  '01':'Alabama','02':'Alaska','04':'Arizona','05':'Arkansas','06':'California','08':'Colorado','09':'Connecticut','10':'Delaware','12':'Florida','13':'Georgia','15':'Hawaii','16':'Idaho','17':'Illinois','18':'Indiana','19':'Iowa','20':'Kansas','21':'Kentucky','22':'Louisiana','23':'Maine','24':'Maryland','25':'Massachusetts','26':'Michigan','27':'Minnesota','28':'Mississippi','29':'Missouri','30':'Montana','31':'Nebraska','32':'Nevada','33':'New Hampshire','34':'New Jersey','35':'New Mexico','36':'New York','37':'North Carolina','38':'North Dakota','39':'Ohio','40':'Oklahoma','41':'Oregon','42':'Pennsylvania','44':'Rhode Island','45':'South Carolina','46':'South Dakota','47':'Tennessee','48':'Texas','49':'Utah','50':'Vermont','51':'Virginia','53':'Washington','54':'West Virginia','55':'Wisconsin','56':'Wyoming'
};

const centers = {
  redmond: {
    name: 'Redmond', state: 'Washington', coordinates: [-122.1215, 47.6740], years: '1970s—today',
    summary: 'A software center shaped by Microsoft, a deep regional workforce, and the wider Puget Sound economy.',
    before: 'Before its technology boom, Redmond was a small Eastside community with farming, logging, and local businesses. This point needs a local-history source before final submission.',
    turns: 'Microsoft moved from Albuquerque to Bellevue in 1979, then opened its Redmond campus in 1986. The personal-computer era made the campus an anchor for suppliers and skilled workers.',
    talent: 'The larger Seattle region supplied engineers and managers. Nearby universities, including the University of Washington, supported the regional talent pipeline. Add a source that directly measures this connection.',
    policy: 'Washington has no corporate income tax, but it does use a Business & Occupation tax on gross receipts. Tax structure is only one factor; company roots and regional talent also mattered.',
    change: 'The draw shifted from suburban campus space and personal-computer software toward cloud services, research, and a broad network of experienced technology workers.',
    factors: ['Anchor company', 'Software talent', 'Regional network'],
    sources: [
      ['Microsoft company timeline', 'https://news.microsoft.com/facts-about-microsoft/'],
      ['Washington Department of Revenue', 'https://dor.wa.gov/education/industry-guides/mortgage-brokers/business-tax-structure-washington-state']
    ],
    unfinished: 'Local “before tech” history and university links need stronger sources.'
  },
  'silicon-valley': {
    name: 'Silicon Valley', state: 'California', coordinates: [-122.1430, 37.4419], years: '1930s—today', representative: true,
    summary: 'A regional technology ecosystem built through Stanford, electronics, defense demand, semiconductors, and venture investment.',
    before: 'The Santa Clara Valley was widely known for orchards and food processing before electronics became dominant. The marker is near Palo Alto and represents a region, not an exact boundary.',
    turns: 'Stanford encouraged commercial engineering. Stanford Industrial Park opened in the early 1950s. Firms such as HP, Shockley Semiconductor, Fairchild, and Intel helped move the region from electronics to silicon chips.',
    talent: 'Stanford research and graduates linked ideas to firms. Skilled workers moved among companies, carrying experience with them. Venture investment helped new firms grow.',
    policy: 'Federal defense purchasing supported early electronics. California taxes corporations; current rates should be checked before presenting because tax rules can change.',
    change: 'The center moved from radio and defense electronics to semiconductors, personal computing, internet businesses, and later software platforms and AI.',
    factors: ['University research', 'Venture capital', 'Worker mobility'],
    sources: [
      ['Stanford: an era of innovation', 'https://www.stanford.edu/about/history'],
      ['Stanford: industrial park history', 'https://engineering100.stanford.edu/stories/a-period-of-transformation'],
      ['California Franchise Tax Board', 'https://www.ftb.ca.gov/file/business/tax-rates.html']
    ],
    unfinished: 'Add a local archive source for the orchard economy.'
  },
  austin: {
    name: 'Austin', state: 'Texas', coordinates: [-97.7431, 30.2672], years: '1960s—today',
    summary: 'A university and government city that added electronics, research consortia, startups, and major company campuses.',
    before: 'Austin was a state-government and university city before its technology sector became a major part of the economy.',
    turns: 'Large electronics firms arrived from the 1960s onward. MCC selected Austin in 1983; Sematech followed in 1988. Dell, founded in Austin in 1984, became another major turning point.',
    talent: 'The University of Texas at Austin supplied research, graduates, and institutional support. Cooperation among university, government, and business helped attract research groups and companies.',
    policy: 'Texas uses a franchise tax based on taxable margin for many entities. State and local recruitment efforts also mattered. Current rules and incentives should be checked before presenting.',
    change: 'Austin’s appeal expanded from lower costs and electronics manufacturing toward a large skilled workforce, startup networks, creative culture, and major offices across many technology fields.',
    factors: ['UT Austin', 'Research consortia', 'Cost + recruitment'],
    sources: [
      ['UT Austin IC² Institute history study', 'https://ic2.utexas.edu/wp-content/uploads/echeverri-2017-austin-entrepreneurial-genesis-report.pdf'],
      ['Texas Comptroller tax guide', 'https://comptroller.texas.gov/transparency/revenue/docs/96-1774.pdf']
    ],
    unfinished: 'Add a city archive source for pre-technology Austin.'
  }
};

const mapEl = document.querySelector('#map');
const wrap = document.querySelector('#canvas-wrap');
const loading = document.querySelector('#loading');
const loadError = document.querySelector('#load-error');
const tooltip = document.querySelector('#tooltip');
const panel = document.querySelector('#info-panel');
const panelKicker = document.querySelector('#panel-kicker');
const panelTitle = document.querySelector('#panel-title');
const panelSummary = document.querySelector('#panel-summary');
const panelBody = document.querySelector('#panel-body');

let renderer, scene, camera, controls, mapGroup, raycaster, pointer;
let selectable = [], hovered = null, markerMeshes = new Map();
let animation = null;
const stateGroups = new Map();
const baseColor = new THREE.Color('#b8c0b4');
const accentColor = new THREE.Color('#a84f35');
const hoverColor = new THREE.Color('#d47a58');

const projection = geoAlbersUsa().scale(1280).translate([480, 300]);
const mapScale = 0.015;
const toWorld = ([x, y]) => new THREE.Vector2((x - 480) * mapScale, -(y - 300) * mapScale);

function infoBlock(title, text) {
  return `<section class="fact-block"><h3>${title}</h3><p>${text}</p></section>`;
}

function openCenter(key) {
  const c = centers[key];
  panelKicker.textContent = c.representative ? 'REGIONAL MARKER • REPRESENTATIVE LOCATION' : `TECHNOLOGY CENTER • ${c.years}`;
  panelTitle.textContent = c.name;
  panelSummary.textContent = c.summary;
  panelBody.innerHTML = [
    infoBlock('Before technology growth', c.before),
    infoBlock('Companies + turning points', c.turns),
    infoBlock('Universities, workers + investment', c.talent),
    infoBlock('Government + state taxes', c.policy),
    infoBlock('How the draw changed', c.change),
    `<section class="fact-block"><h3>Sources</h3><ul class="source-list">${c.sources.map(([label,url]) => `<li><a href="${url}" target="_blank" rel="noopener">${label}</a></li>`).join('')}</ul></section>`,
    `<span class="unfinished">UNFINISHED: ${c.unfinished}</span>`
  ].join('');
  panel.classList.add('open');
}

function openState(id) {
  const name = stateNames[id] || 'State';
  const special = {'53':'Washington — home to Redmond','06':'California — home to Silicon Valley','48':'Texas — home to Austin'}[id];
  panelKicker.textContent = 'STATE PROFILE';
  panelTitle.textContent = name;
  panelSummary.textContent = special || 'This state is included for geographic context. Its technology history is not yet part of the three-center study.';
  panelBody.innerHTML = special
    ? `<section class="fact-block"><h3>Explore the center</h3><p>Use the location button or marker to open the full history notes for ${special.split('— home to ')[1]}.</p></section><span class="unfinished">EDITABLE SAMPLE</span>`
    : `<span class="unfinished">UNFINISHED: Add state-specific history if your project expands.</span>`;
  panel.classList.add('open');
}

function makeShape(rings) {
  const outer = rings[0].map(toWorld);
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  for (const ring of rings.slice(1)) {
    const pts = ring.map(toWorld);
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    shape.holes.push(new THREE.Path(pts));
  }
  return shape;
}

function addPolygon(group, rings, material, id) {
  if (!rings?.[0]?.length) return;
  const shape = makeShape(rings);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: true, bevelSegments: 1, bevelSize: .018, bevelThickness: .018, curveSegments: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { type: 'state', id, name: stateNames[id] };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  selectable.push(mesh);

  for (const ring of rings) {
    const pts = ring.map(p => { const v = toWorld(p); return new THREE.Vector3(v.x, v.y, .181); });
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: .72 }));
    line.renderOrder = 4;
    group.add(line);
  }
}

function addMarker(key, data) {
  const projected = projection(data.coordinates);
  if (!projected) return;
  const p = toWorld(projected);
  const marker = new THREE.Group();
  marker.position.set(p.x, p.y, .32);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .32, 12), new THREE.MeshStandardMaterial({ color: '#713926', roughness: .55 }));
  stem.rotation.x = Math.PI / 2;
  stem.position.z = .02;
  marker.add(stem);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(.105, 24, 18), new THREE.MeshStandardMaterial({ color: '#f2d6b2', emissive: '#a84f35', emissiveIntensity: .65, roughness: .32 }));
  dot.position.z = .22;
  dot.userData = { type: 'marker', key, name: data.name };
  marker.add(dot);
  const halo = new THREE.Mesh(new THREE.RingGeometry(.15, .2, 40), new THREE.MeshBasicMaterial({ color: '#a84f35', transparent: true, opacity: .45, side: THREE.DoubleSide }));
  halo.position.z = .17;
  marker.add(halo);
  mapGroup.add(marker);
  selectable.push(dot);
  markerMeshes.set(key, marker);
}

function initScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#e8e6de', 14, 30);
  camera = new THREE.PerspectiveCamera(38, wrap.clientWidth / wrap.clientHeight, .1, 100);
  camera.position.set(0, -9.8, 12.8);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(wrap.clientWidth, wrap.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mapEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .07;
  controls.minDistance = 7;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * .49;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight('#fffdf4', '#766f63', 2.6));
  const key = new THREE.DirectionalLight('#fff4dd', 4.2);
  key.position.set(-4, -5, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -10; key.shadow.camera.right = 10; key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#afc6c3', 1.2); fill.position.set(6, 5, 5); scene.add(fill);

  const base = new THREE.Mesh(new THREE.BoxGeometry(17, 10.8, .14), new THREE.MeshStandardMaterial({ color: '#dad8cf', roughness: .92 }));
  base.position.z = -.19; base.receiveShadow = true; scene.add(base);
  mapGroup = new THREE.Group(); scene.add(mapGroup);
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
}

async function loadMap() {
  try {
    const response = await fetch('assets/states-albers-10m.json');
    if (!response.ok) throw new Error(`Map data request failed: ${response.status}`);
    const topology = await response.json();
    const geo = feature(topology, topology.objects.states);
    for (const f of geo.features) {
      const id = String(f.id).padStart(2, '0');
      if (!stateNames[id]) continue;
      const highlighted = ['06','48','53'].includes(id);
      const material = new THREE.MeshStandardMaterial({ color: highlighted ? accentColor : baseColor, roughness: .78, metalness: .02, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      const group = new THREE.Group(); group.userData = { id, material, base: highlighted ? accentColor.clone() : baseColor.clone() };
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polygons.forEach(poly => addPolygon(group, poly, material, id));
      mapGroup.add(group); stateGroups.set(id, group);
    }
    Object.entries(centers).forEach(([key, data]) => addMarker(key, data));
    loading.hidden = true;
    bindInteraction();
  } catch (err) {
    console.error(err);
    loading.hidden = true;
    loadError.hidden = false;
  }
}

function getHit(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(selectable, false)[0]?.object || null;
}

function restoreHover() {
  if (!hovered) return;
  if (hovered.userData.type === 'state') stateGroups.get(hovered.userData.id)?.userData.material.color.copy(stateGroups.get(hovered.userData.id).userData.base);
  if (hovered.userData.type === 'marker') hovered.scale.setScalar(1);
  hovered = null;
}

function bindInteraction() {
  renderer.domElement.addEventListener('pointermove', event => {
    const hit = getHit(event);
    if (hit !== hovered) {
      restoreHover(); hovered = hit;
      if (hovered?.userData.type === 'state') stateGroups.get(hovered.userData.id).userData.material.color.copy(hoverColor);
      if (hovered?.userData.type === 'marker') hovered.scale.setScalar(1.35);
    }
    tooltip.textContent = hovered?.userData.name || '';
    tooltip.style.left = `${event.clientX - wrap.getBoundingClientRect().left}px`;
    tooltip.style.top = `${event.clientY - wrap.getBoundingClientRect().top}px`;
    tooltip.classList.toggle('visible', Boolean(hovered));
  });
  renderer.domElement.addEventListener('pointerleave', () => { restoreHover(); tooltip.classList.remove('visible'); });
  renderer.domElement.addEventListener('click', event => {
    const hit = getHit(event); if (!hit) return;
    if (hit.userData.type === 'marker') focusCenter(hit.userData.key);
    else focusState(hit.userData.id);
  });
}

function worldCenterForState(id) {
  const box = new THREE.Box3().setFromObject(stateGroups.get(id));
  return box.getCenter(new THREE.Vector3());
}

function moveCamera(position, target, duration = 850) {
  const fromPos = camera.position.clone(); const fromTarget = controls.target.clone(); const started = performance.now();
  animation = now => {
    const t = Math.min(1, (now - started) / duration); const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(fromPos, position, eased); controls.target.lerpVectors(fromTarget, target, eased);
    if (t < 1) requestAnimationFrame(animation); else animation = null;
  };
  requestAnimationFrame(animation);
}

function focusCenter(key) {
  const marker = markerMeshes.get(key); if (!marker) return;
  const target = marker.position.clone(); target.z = 0;
  moveCamera(new THREE.Vector3(target.x, target.y - 4.0, 5.4), target);
  openCenter(key);
}

function focusState(id) {
  const target = worldCenterForState(id); target.z = 0;
  const box = new THREE.Box3().setFromObject(stateGroups.get(id));
  const size = box.getSize(new THREE.Vector3()); const dist = Math.max(4.7, Math.max(size.x, size.y) * 2.4);
  moveCamera(new THREE.Vector3(target.x, target.y - dist * .55, dist), target);
  openState(id);
}

function resetView() { moveCamera(new THREE.Vector3(0, -9.8, 12.8), new THREE.Vector3(0, 0, 0)); }
function topView() { moveCamera(new THREE.Vector3(0, -.01, 15.5), new THREE.Vector3(0, 0, 0)); }

function fillContent() {
  const cards = Object.entries(centers).map(([key,c]) => `<article class="compare-card"><p class="place">${c.state.toUpperCase()}</p><h3>${c.name}</h3>${c.factors.map((f,i) => `<div class="factor"><span>${['Starting engine','Network effect','Later draw'][i]}</span><strong>${f}</strong></div>`).join('')}</article>`).join('');
  document.querySelector('#comparison-grid').innerHTML = cards;
  document.querySelector('#text-grid').innerHTML = Object.entries(centers).map(([key,c]) => `<article class="text-card"><p class="place">${c.state.toUpperCase()} • ${c.years}</p><h3>${c.name}</h3><p>${c.summary}</p><button type="button" data-text-focus="${key}">Open full notes</button></article>`).join('');
}

function bindUI() {
  document.querySelectorAll('[data-focus]').forEach(btn => btn.addEventListener('click', () => focusCenter(btn.dataset.focus)));
  document.querySelectorAll('[data-text-focus]').forEach(btn => btn.addEventListener('click', () => { focusCenter(btn.dataset.textFocus); document.querySelector('.map-card').scrollIntoView({ behavior: 'smooth' }); }));
  document.querySelector('#reset-view').addEventListener('click', resetView);
  document.querySelector('#top-view').addEventListener('click', topView);
  document.querySelector('#panel-close').addEventListener('click', () => panel.classList.remove('open'));
  const comparison = document.querySelector('#comparison');
  document.querySelector('#compare-button').addEventListener('click', () => { comparison.hidden = false; comparison.scrollIntoView({ behavior: 'smooth' }); });
  document.querySelector('#comparison-close').addEventListener('click', () => { comparison.hidden = true; document.querySelector('.map-card').scrollIntoView({ behavior: 'smooth' }); });
  const help = document.querySelector('#help-card'); const helpBtn = document.querySelector('#help-button');
  helpBtn.addEventListener('click', () => { help.hidden = !help.hidden; helpBtn.setAttribute('aria-expanded', String(!help.hidden)); });
  const present = document.querySelector('#present-button');
  present.addEventListener('click', () => { const on = document.body.classList.toggle('presentation'); present.setAttribute('aria-pressed', String(on)); present.querySelector('span:last-child').textContent = on ? 'Exit' : 'Present'; setTimeout(onResize, 50); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { panel.classList.remove('open'); if (document.body.classList.contains('presentation')) present.click(); } });
}

function onResize() {
  if (!renderer) return;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}

function tick(time) {
  requestAnimationFrame(tick); controls?.update();
  markerMeshes.forEach((m, i) => { const halo = m.children[2]; if (halo) { const s = 1 + .08 * Math.sin(time * .002 + i * 1.7); halo.scale.setScalar(s); } });
  renderer?.render(scene, camera);
}

fillContent();
initScene();
bindUI();
loadMap();
addEventListener('resize', onResize);
tick(0);
