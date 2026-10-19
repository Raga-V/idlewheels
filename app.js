// IdleWheels: rent out your idle vehicle; a local Gemma checks every handover for new damage.
// No backend. Listings live in this browser; photos go only to the Ollama server you point it at (your laptop).

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const ANGLES = ['Front', 'Left side', 'Right side', 'Rear'];
const HINTS = {
  Front: 'Stand 2 m back, headlight centred',
  'Left side': 'Whole side in frame, both wheels',
  'Right side': 'Same distance as the left side',
  Rear: 'Tail light and number plate in frame',
};
let settings = { url: 'http://localhost:11434', model: 'gemma3:4b', ...load('iw-settings', {}) };
let listings = load('iw-listings', [
  { id: 'demo1', owner: 'Dad', vehicle: 'Honda Activa 6G', type: 'Scooter', area: 'Bachupally', from: '09:30', to: '17:30', price: 40 },
]);
// angle -> dataURL (downscaled). Kept in the browser so a reload between pickup and return loses nothing.
const shots = load('iw-shots', { before: {}, after: {} });
const keepShots = () => save('iw-shots', shots);
let results = null;
let aiReady = false;
let checkVeh = listings[0]?.vehicle || '';
let draftType = 'Scooter';

// ------------------------------------------------------------------ icons + Tyro the tyre

const ICONS = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  laptop: '<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  sparkle: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="m19 15 .7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1.1-1.5 2.2"/><path d="M12 17v.01"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  scooter: '<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17H14l2.5-6.5L15 5h-2.5"/><path d="M3.5 13H10l2 4"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5 9 10h5l4.5 6.5"/><path d="M14 10l-1.5-4H15"/><path d="M8 10h4"/>',
  car: '<path d="M5 17H3v-4.5l2.2-5A2 2 0 0 1 7 6h10a2 2 0 0 1 1.8 1.5l2.2 5V17h-2"/><path d="M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M4 12h16"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const VEH_ICON = { Scooter: 'scooter', Bike: 'bike', Car: 'car' };

const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="-3" rx="3.6" ry="4.6" class="fi"/><circle cx="${x + 1.3}" cy="-4.9" r="1.4" class="hl"/></g>`;
const BLUSH = '<ellipse cx="-18" cy="6" rx="4.6" ry="2.6" class="bl"/><ellipse cx="18" cy="6" rx="4.6" ry="2.6" class="bl"/>';
const FACES = {
  happy: eye(-10) + eye(10) + BLUSH + '<path class="fs" d="M-4.5 6.5q4.5 5 9 0"/>',
  joy: '<path class="fs" d="M-14 -1q4-6 8 0M6 -1q4-6 8 0"/>' + BLUSH + '<path class="fi" d="M-6 5h12q-1 8-6 8t-6-8z"/><path class="tg" d="M-3.2 10.8q3.2-2.4 6.4 0q-.8 2.2-3.2 2.2t-3.2-2.2z"/>',
  worried: eye(-10) + eye(10) + BLUSH + '<path class="fs" d="M-15 -10-7 -13M15 -10 7 -13"/><path class="fs" d="M-6 10q3-3.5 6 0t6 0"/><path class="sw" d="M23 -21q3.5 5 0 7.5q-3.5-2.5 0-7.5z"/>',
  unsure: eye(-10) + '<path class="fs" d="M6.5 -3h7"/>' + BLUSH + '<path class="fs" d="M-5 9q5-2.5 10 0"/><text x="30" y="-36" class="mark">?</text>',
  sleepy: '<path class="fs" d="M-14 -2q4 3.5 8 0M6 -2q4 3.5 8 0"/>' + BLUSH + '<ellipse cx="0" cy="8" rx="2.2" ry="2.6" class="fi"/><text x="30" y="-36" class="mark">z</text><text x="38" y="-44" class="mark sm">z</text>',
};
const BOLTS = [0, 72, 144, 216, 288].map((a) => {
  const t = (a * Math.PI) / 180;
  return `<circle cx="${(32.8 * Math.sin(t)).toFixed(1)}" cy="${(-32.8 * Math.cos(t)).toFixed(1)}" r="1.5"/>`;
}).join('');
function tyre(mood = 'happy', cls = '') {
  return `<svg class="tyre ${cls}" viewBox="-50 -54 100 108" aria-hidden="true">
    <ellipse class="t-shadow" cx="0" cy="50" rx="28" ry="3.5"/>
    <g class="t-body">
      <g class="tread"><circle r="45" class="t-out"/><circle r="45" class="t-notch"/></g>
      <circle r="37" class="t-wall"/><g class="t-bolt">${BOLTS}</g>
      <path class="t-shine" d="M-35.5 -20.5A41 41 0 0 1 -14 -38.5"/>
      <circle r="29" class="t-face"/>
      <g class="face">${FACES[mood]}</g>
    </g>
  </svg>`;
}
const say = (mood, html, cls = '') => `<div class="tyro-say">${tyre(mood, 'sm ' + cls)}<div class="bubble">${html}</div></div>`;

// ------------------------------------------------------------------ Ollama

async function aiStatus() {
  const pill = $('#ai-status');
  let label;
  try {
    const r = await fetch(`${settings.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const tags = (await r.json()).models?.map((m) => m.name) || [];
    aiReady = tags.some((t) => t.startsWith(settings.model));
    label = aiReady ? `AI: ${settings.model} ready` : `AI: ${settings.model} not pulled`;
  } catch {
    aiReady = false;
    label = 'AI: laptop not reachable';
  }
  pill.className = 'status ' + (aiReady ? 'ok' : 'bad');
  pill.innerHTML = `<i class="dot"></i><span class="lbl-long">${esc(label)}</span><span class="lbl-short">${aiReady ? 'AI ready' : 'AI offline'}</span>`;
  return aiReady;
}

// Order matters: Ollama fills JSON fields in schema order, so the model describes
// each photo BEFORE it is allowed to decide what changed.
const SCHEMA = {
  type: 'object',
  properties: {
    before_description: { type: 'string' },
    after_description: { type: 'string' },
    same_vehicle_and_angle: { type: 'boolean' },
    new_damage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          part: { type: 'string' },
          kind: { type: 'string', enum: ['scratch', 'dent', 'crack', 'mark or sticker', 'missing part', 'broken part', 'other'] },
          description: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'moderate', 'major'] },
        },
        required: ['part', 'kind', 'description', 'severity'],
      },
    },
    verdict: { type: 'string', enum: ['no_new_damage', 'new_damage', 'unsure'] },
    confidence: { type: 'number' },
  },
  required: ['before_description', 'after_description', 'same_vehicle_and_angle', 'new_damage', 'verdict', 'confidence'],
};

function prompt(angle, vehicle) {
  return `You are a careful vehicle inspector settling a rental handover between a vehicle owner and a renter.
Image 1 is the BEFORE photo, taken when the owner handed over the ${vehicle || 'vehicle'}.
Image 2 is the AFTER photo of the same ${angle.toLowerCase()} view, taken when the renter returned it.

1. Describe the visible condition in image 1 (body panels, scratches, dents, marks, mirrors, lights).
2. Describe the visible condition in image 2 the same way.
3. List ONLY damage that is visible in image 2 and NOT in image 1: new scratches, dents, cracks, marks, stickers or tape, missing or broken parts.

Rules:
- Ignore differences in lighting, shadows, reflections, camera angle, zoom and background.
- Ignore dust or water unless it hides a part.
- Do not invent damage. If you cannot tell, use verdict "unsure" and a low confidence.
- If the two photos do not show the same vehicle from roughly the same angle, set same_vehicle_and_angle to false and verdict "unsure".
- confidence is a number from 0 to 1.`;
}

async function checkAngle(angle, vehicle) {
  const strip = (d) => d.split(',')[1];
  const body = {
    model: settings.model,
    stream: false,
    format: SCHEMA,
    options: { temperature: 0.1, num_ctx: 4096 },
    messages: [{ role: 'user', content: prompt(angle, vehicle), images: [strip(shots.before[angle]), strip(shots.after[angle])] }],
  };
  const t0 = performance.now();
  const r = await fetch(`${settings.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Ollama said ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const out = JSON.parse(data.message.content);
  out.seconds = Math.round((performance.now() - t0) / 100) / 10;
  if (out.verdict === 'no_new_damage' && out.new_damage?.length) out.verdict = 'new_damage';
  return out;
}

// Same trick as the damage check: reason first, then commit to numbers.
const PRICE_SCHEMA = {
  type: 'object',
  properties: {
    reasoning: { type: 'string' },
    low: { type: 'number' },
    high: { type: 'number' },
    price_per_hour: { type: 'number' },
  },
  required: ['reasoning', 'low', 'high', 'price_per_hour'],
};

async function suggestPrice(l) {
  const body = {
    model: settings.model,
    stream: false,
    format: PRICE_SCHEMA,
    options: { temperature: 0.2 },
    messages: [{ role: 'user', content: `You help vehicle owners in India price peer-to-peer hourly rentals.
Vehicle: ${l.vehicle} (${l.type})
Area: ${l.area || 'not given'}
Available: ${l.from} to ${l.to} on weekdays. The renter brings their own fuel.

Suggest a fair price in Indian rupees per hour that a student or office-goer nearby would actually pay.
Compare with what Rapido, Bounce/Yulu-style scooter rentals, autos and app cabs cost for similar trips.
Keep it a little cheaper than commercial rentals, since this is a neighbour's vehicle.
In reasoning, explain in 2-3 short sentences. low and high are a sensible range; price_per_hour is your pick. All whole rupees.` }],
  };
  const t0 = performance.now();
  const r = await fetch(`${settings.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Ollama said ${r.status}: ${await r.text()}`);
  const out = JSON.parse((await r.json()).message.content);
  out.seconds = Math.round((performance.now() - t0) / 100) / 10;
  return out;
}

// ------------------------------------------------------------------ images

function downscale(file, max = 768) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ------------------------------------------------------------------ routing

const views = {};
const main = $('#main');
const NAV = [['home', 'home', 'Home'], ['rent', 'plus', 'List vehicle'], ['check', 'shield', 'Damage check'], ['setup', 'laptop', 'AI setup']];
$('#tabs').innerHTML = NAV.map(([v, i, t]) => `<a href="#${v}" data-view="${v}">${icon(i)}<span>${t}</span></a>`).join('');
$('#logo').innerHTML = tyre('happy');
$('#foot').innerHTML = `${icon('lock', 'xs')} Photos never leave your devices. The AI runs on Gemma, an open-weight model, on your own laptop. · <a href="https://github.com/Raga-V/idlewheels" target="_blank" rel="noopener">Source on GitHub</a>`;
let current;
function render() {
  current = views[location.hash.slice(1)] ? location.hash.slice(1) : 'home';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === current));
  views[current]();
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ------------------------------------------------------------------ home

const step = (n, ic, tone, title, text) => `
  <article class="how-card">
    <div class="how-top"><span class="ib ${tone}">${icon(ic)}</span><span class="num">0${n}</span></div>
    <h3>${title}</h3><p class="muted">${text}</p>
  </article>`;

const listingCard = (l) => `
  <article class="listing">
    <div class="veh-tile">${icon(VEH_ICON[l.type] || 'scooter')}</div>
    <div class="grow">
      <h3>${esc(l.vehicle)}</h3>
      <p class="muted small">${icon('pin', 'xs')} ${esc(l.area || 'Nearby')} · by ${esc(l.owner)}</p>
      <div class="listing-foot">
        <span class="tag">${icon('clock', 'xs')} Free ${esc(l.from)}–${esc(l.to)}</span>
        <span class="price">₹${esc(l.price)}<small>/hr</small></span>
      </div>
    </div>
    <button class="icon-btn" data-del="${esc(l.id)}" title="Remove listing" aria-label="Remove ${esc(l.vehicle)}">${icon('trash')}</button>
  </article>`;

views.home = () => {
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">${icon('clock')} Rent out the hours you don't ride</span>
        <h1>Your scooter naps 9 hours a day. <em>Let it earn.</em></h1>
        <p class="lead">IdleWheels lets you rent your bike or car to someone nearby while you're at work or in class. When it comes back, a local AI compares photos and points out only the new scratches. No arguments, no cloud.</p>
        <div class="row">
          <a class="btn" href="#rent">${icon('plus')} List my vehicle</a>
          <a class="btn ghost" href="#check">${icon('shield')} Try the damage check</a>
        </div>
      </div>
      <div class="hero-art">
        <div class="blob"></div><div class="road"></div>
        ${tyre('happy', 'big float')}
        <span class="chip c1">${icon('lock', 'xs')} Photos stay on your laptop</span>
        <span class="chip c2">${icon('sparkle', 'xs')} ₹0 per AI check</span>
      </div>
    </section>

    <section class="section">
      <h2 class="h2">How it works</h2>
      <div class="how">
        ${step(1, 'clock', 'lilac', 'List the idle hours', 'Say when your vehicle is free, like 9:30 to 5:30. Gemma suggests a fair hourly price.')}
        ${step(2, 'camera', 'sun', 'Snap 4 photos at pickup', 'Front, left, right and rear. The renter snaps the same 4 when they bring it back.')}
        ${step(3, 'shield', 'mint', 'AI checks for new damage', 'Gemma on your own laptop compares each pair and lists only what is new. Both of you keep the PDF.')}
      </div>
    </section>

    <section class="section">
      <div class="sec-head"><h2 class="h2">Idle near you</h2><a href="#rent" class="link">List yours ${icon('arrow', 'xs')}</a></div>
      <div class="listings">
        ${listings.map(listingCard).join('')}
        <a class="listing add" href="#rent">${icon('plus')}<span>Your vehicle here</span></a>
      </div>
    </section>`;
  main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
    listings = listings.filter((l) => l.id !== b.dataset.del);
    save('iw-listings', listings); views.home();
  }));
};

// ------------------------------------------------------------------ list a vehicle

views.rent = () => {
  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('plus')} Rent out</span>
      <h1>List your idle vehicle</h1>
      <p class="lead">Tell people nearby when it's free and what it costs. Takes a minute.</p>
    </header>
    <section class="card form">
      <div class="field"><span class="lbl">What are you renting out?</span>
        <div class="seg" id="type">${Object.keys(VEH_ICON).map((t) => `<button type="button" data-t="${t}" class="${t === draftType ? 'on' : ''}">${icon(VEH_ICON[t])}<span>${t}</span></button>`).join('')}</div>
      </div>
      <div class="grid2">
        <div class="field"><label for="v">Vehicle</label><input id="v" placeholder="Honda Activa 6G"></div>
        <div class="field"><label for="o">Your name</label><input id="o" placeholder="Raga"></div>
        <div class="field"><label for="a">Area</label><input id="a" placeholder="Bachupally"></div>
        <div class="field two">
          <div><label for="f">Free from</label><input id="f" type="time" value="09:30"></div>
          <div><label for="u">Until</label><input id="u" type="time" value="17:30"></div>
        </div>
      </div>
      <div class="price-box">
        <div class="field"><label for="p">Price per hour</label><div class="prefix"><span>₹</span><input id="p" type="number" min="0" value="40"></div></div>
        <button type="button" class="btn soft" id="ask">${icon('sparkle')} Ask Gemma for a fair price</button>
      </div>
      <div id="sugg"></div>
      <div class="row end"><button class="btn" id="add">${icon('check')} Add listing</button></div>
    </section>
    <p class="note">${icon('help', 'xs')} <span>This is a demo. Listings are saved in this browser only. A real launch needs commercial (rental) registration and insurance; private-plate vehicles can't legally be rented out for money in India.</span></p>`;

  main.querySelectorAll('#type button').forEach((b) => (b.onclick = () => {
    draftType = b.dataset.t;
    main.querySelectorAll('#type button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const g = (id) => $(id).value.trim();
  $('#add').onclick = () => {
    if (!g('#v')) return $('#v').focus();
    listings.push({ id: crypto.randomUUID?.() || String(Date.now()), owner: g('#o') || 'Me', vehicle: g('#v'), type: draftType, area: g('#a'), from: g('#f'), to: g('#u'), price: g('#p') });
    save('iw-listings', listings);
    location.hash = 'home';
  };
  $('#ask').onclick = async () => {
    if (!g('#v')) return $('#v').focus();
    const sugg = $('#sugg');
    if (!(await aiStatus())) { sugg.innerHTML = say('sleepy', `I can't reach Gemma on this laptop. Open <a href="#setup">AI setup</a> to wake me up.`); return; }
    $('#ask').disabled = true;
    sugg.innerHTML = say('happy', 'Thinking about a fair price for your area…', 'rolling');
    try {
      const s = await suggestPrice({ vehicle: g('#v'), type: draftType, area: g('#a'), from: g('#f'), to: g('#u') });
      $('#p').value = Math.round(s.price_per_hour);
      // The model sometimes repeats the numbers at the end of its reasoning; the range line already shows them.
      const why = s.reasoning.split('\n').filter((l) => !/^\s*(low|high|price)/i.test(l)).join(' ');
      sugg.innerHTML = say('joy', `<b class="say-big">₹${esc(Math.round(s.price_per_hour))}/hr feels fair</b>
        <span class="muted small">Fair range ₹${esc(Math.round(s.low))}–${esc(Math.round(s.high))} · took ${esc(s.seconds)}s</span><p>${esc(why)}</p>`);
    } catch (e) { sugg.innerHTML = say('worried', esc(e.message)); }
    $('#ask').disabled = false;
  };
};

// ------------------------------------------------------------------ handover check

function slot(phase, a, label) {
  const img = shots[phase][a];
  return `<label class="slot ${phase} ${img ? 'has' : ''}">
    ${img ? `<img src="${img}" alt="${label} photo, ${a}">` : `<span class="slot-empty">${icon('camera')}<span>Add photo</span></span>`}
    <span class="slot-tag">${label}${img ? ' · retake' : ''}</span>
    <input type="file" accept="image/*" capture="environment" data-phase="${phase}" data-angle="${a}">
  </label>`;
}

views.check = () => {
  const nb = ANGLES.filter((a) => shots.before[a]).length;
  const na = ANGLES.filter((a) => shots.after[a]).length;
  const ready = ANGLES.filter((a) => shots.before[a] && shots.after[a]);
  const at = results ? 3 : na || nb === 4 ? 2 : 1;
  const guide = results ? ''
    : at === 1 ? (nb ? `${nb} of 4 pickup photos done. Keep going: same spots, every time.` : `Owner: snap the <b>pickup</b> photos before handing over the keys. Stand about 2 m away.`)
    : !na ? `Pickup photos saved. Hand over the keys! When the vehicle comes back, snap the <b>return</b> photos from the same spots.`
    : ready.length < 4 ? `Welcome back! ${ready.length} of 4 pairs ready. Match the pickup angles as closely as you can.`
    : `All 4 pairs ready. Tap <b>Check for new damage</b> and I'll compare them.`;
  const stepLi = (n, label) => `<li class="${at > n || results ? 'done' : at === n ? 'cur' : ''}"><b>${at > n || results ? icon('check', 'xs') : n}</b><span>${label}</span></li>`;

  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('shield')} Handover check</span>
      <h1>Settle "that scratch was already there"</h1>
      <p class="lead">Photos at pickup, photos at return. Gemma on your laptop spots what's new.</p>
    </header>
    <ol class="stepper">${stepLi(1, 'Pickup photos')}${stepLi(2, 'Return photos')}${stepLi(3, 'AI report')}</ol>
    ${guide ? say('happy', guide) : ''}
    <section class="card veh-row">
      <label for="veh">${icon('scooter')} Vehicle</label>
      <select id="veh">${listings.length ? listings.map((l) => `<option ${l.vehicle === checkVeh ? 'selected' : ''}>${esc(l.vehicle)}</option>`).join('') : '<option>My vehicle</option>'}</select>
    </section>
    <div class="angles">${ANGLES.map((a) => `
      <article class="angle">
        <header><h3>${a}</h3><span class="muted small">${HINTS[a]}</span></header>
        <div class="pair-slots">${slot('before', a, 'Pickup')}${slot('after', a, 'Return')}</div>
      </article>`).join('')}
    </div>
    <div class="run-bar noprint">
      <button class="btn" id="run" ${ready.length ? '' : 'disabled'}>${icon('sparkle')} ${ready.length ? `Check ${ready.length} pair${ready.length === 1 ? '' : 's'} for new damage` : 'Add photo pairs to check'}</button>
      <button class="btn ghost" id="reset">${icon('refresh')}<span>Start over</span></button>
    </div>
    <div id="prog"></div>
    <div id="out">${results ? report(results) : ''}</div>`;

  $('#veh').onchange = () => (checkVeh = $('#veh').value);
  main.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    shots[inp.dataset.phase][inp.dataset.angle] = await downscale(f);
    keepShots(); results = null; views.check();
  }));
  $('#reset').onclick = () => { shots.before = {}; shots.after = {}; keepShots(); results = null; views.check(); };
  $('#print')?.addEventListener('click', () => window.print());
  $('#run').onclick = async () => {
    const prog = $('#prog');
    if (!(await aiStatus())) { prog.innerHTML = say('sleepy', `I can't reach Gemma on this laptop. Open <a href="#setup">AI setup</a> to wake me up.`); return; }
    const veh = $('#veh').value; const res = { vehicle: veh, at: new Date(), angles: [] };
    $('#run').disabled = true;
    for (const [i, a] of ready.entries()) {
      prog.innerHTML = say('happy', `Comparing the <b>${a.toLowerCase()}</b> photos… (${i + 1} of ${ready.length})`, 'rolling');
      try { res.angles.push({ angle: a, ...(await checkAngle(a, veh)) }); }
      catch (e) { res.angles.push({ angle: a, verdict: 'unsure', error: e.message, new_damage: [] }); }
    }
    results = res; views.check();
    $('#out').scrollIntoView({ behavior: 'smooth' });
  };
};

function overall(r) {
  if (r.angles.some((a) => a.verdict === 'new_damage')) return ['bad', 'worried', 'New damage found', 'Go over the marked spots together before you settle the deposit.'];
  if (r.angles.some((a) => a.verdict === 'unsure')) return ['unsure', 'unsure', 'Some angles need a closer look', "Gemma wasn't sure about some photos. Check those spots together, or retake them."];
  return ['ok', 'joy', 'No new damage', 'Everything matches the pickup photos. Hand back the deposit.'];
}

const BADGE = {
  new_damage: ['alert', 'New damage'],
  no_new_damage: ['check', 'Looks the same'],
  unsure: ['help', 'Unsure'],
};

function report(r) {
  const [cls, mood, title, sub] = overall(r);
  return `<section class="report">
    <div class="verdict v-${cls}">${tyre(mood, 'md')}
      <div><span class="eyebrow">Handover report · ${esc(r.vehicle)}</span><h2>${title}</h2><p>${sub}</p></div>
    </div>
    <p class="muted small meta">${r.at.toLocaleString()} · checked by ${esc(settings.model)} running on this laptop</p>
    <div class="results">${r.angles.map((a) => {
      const [bi, bl] = a.error ? ['alert', 'Error'] : BADGE[a.verdict] || BADGE.unsure;
      const conf = Math.round((a.confidence || 0) * 100);
      return `<article class="res">
        <header><h3>${esc(a.angle)}</h3><span class="badge b-${a.error ? 'unsure' : esc(a.verdict)}">${icon(bi, 'xs')} ${bl}</span></header>
        <div class="pair">
          <figure><img src="${shots.before[a.angle]}" alt=""><figcaption>Pickup</figcaption></figure>
          <figure><img src="${shots.after[a.angle]}" alt=""><figcaption>Return</figcaption></figure>
        </div>
        ${a.error ? `<p class="warn">${esc(a.error)}</p>` : ''}
        ${a.same_vehicle_and_angle === false ? `<p class="warn">These two photos don't look like the same view. Retake the return photo.</p>` : ''}
        ${a.new_damage?.length
          ? `<ul class="dmg">${a.new_damage.map((d) => `<li><span><b>${esc(d.part)}</b> · ${esc(d.kind)}<br><span class="muted small">${esc(d.description)}</span></span><span class="sev ${esc(d.severity)}">${esc(d.severity)}</span></li>`).join('')}</ul>`
          : a.error ? '' : `<p class="muted small">Nothing new spotted.</p>`}
        ${a.error ? '' : `<div class="conf"><span>Confidence</span><div class="meter"><i style="width:${conf}%"></i></div><b>${conf}%</b><span class="muted">· ${esc(a.seconds)}s</span></div>`}
      </article>`;
    }).join('')}</div>
    <div class="row noprint"><button class="btn" id="print">${icon('printer')} Save report as PDF</button>
      <span class="muted small">Both of you keep a copy. That's the whole dispute process.</span></div>
  </section>`;
}

// ------------------------------------------------------------------ AI setup

views.setup = () => {
  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('laptop')} AI setup</span>
      <h1>Wake up the AI inspector</h1>
      <p class="lead">The damage check and price tips run on Gemma, an open model, right on your laptop.</p>
    </header>
    ${say(aiReady ? 'joy' : 'sleepy', aiReady ? `I'm awake! <b>${esc(settings.model)}</b> is ready on this laptop.` : `I'm asleep. Follow the three steps below to wake me up.`)}
    <section class="card">
      <ol class="steps-list">
        <li><b>Install Ollama</b> from <a href="https://ollama.com" target="_blank" rel="noopener">ollama.com</a>, then run <code>ollama pull gemma3:4b</code></li>
        <li><b>Let this site talk to it.</b> Windows: <code>setx OLLAMA_ORIGINS "${esc(location.origin)}"</code>, then quit and reopen Ollama from the tray. Mac/Linux: <code>OLLAMA_ORIGINS="${esc(location.origin)}" ollama serve</code></li>
        <li><b>Open IdleWheels on the same laptop.</b> If Chrome asks to access devices on your local network, click Allow.</li>
      </ol>
      <div class="grid2">
        <div class="field"><label for="url">Ollama address</label><input id="url" value="${esc(settings.url)}"></div>
        <div class="field"><label for="model">Model</label><input id="model" value="${esc(settings.model)}"></div>
      </div>
      <div class="row"><button class="btn" id="saveS">${icon('refresh')} Save & test</button><span id="st" class="muted small"></span></div>
    </section>
    <section class="card why">
      <span class="ib mint">${icon('lock')}</span>
      <div><h3>Why on your laptop?</h3>
      <p class="muted">Vehicle photos show number plates, homes and faces. They stay between the owner, the renter and the owner's own laptop. Every check costs ₹0, so you can check every handover, and you can swap in a bigger model like <code>gemma3:12b</code> any time.</p></div>
    </section>`;
  $('#saveS').onclick = async () => {
    settings = { url: $('#url').value.trim().replace(/\/$/, ''), model: $('#model').value.trim() };
    save('iw-settings', settings);
    await aiStatus();
    views.setup();
    $('#st').textContent = aiReady ? 'Connected' : 'Not reachable. Check step 2 and that Ollama is running.';
  };
};

render();
aiStatus().then(() => current === 'setup' && views.setup());
