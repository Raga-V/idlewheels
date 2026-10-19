// IdleWheels: neighbours rent each other's idle vehicles; a local Gemma checks every handover for new damage.
// Listings, bookings and chat live on the IdleWheels server (server.js).
// Photos and the AI never leave this browser and the Ollama server it points at (the owner's laptop).

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
// The GitHub Pages copy has no server of its own, so it talks to the one on Render.
const API = location.hostname.endsWith('github.io') ? 'https://idlewheels.onrender.com' : '';
let me = load('iw-session', null);   // { token, id, name, phone } while logged in
let listingPhoto = null;             // data URL of the photo picked in the listing form
let listings = [];
// angle -> dataURL (downscaled), one set per booking. Kept in the browser so a reload between pickup and return loses nothing.
let shotsKey = 'iw-shots-free';
let shots = { before: {}, after: {} };
const keepShots = () => save(shotsKey, shots);
let results = null;
let aiReady = false;
let checkBooking = null;
let checkVeh = load('iw-veh', '');
let draftType = 'Scooter';
let poll = null;

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
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  send: '<path d="M4 12 20 4l-5 16-3.5-6.5z"/><path d="m11.5 13.5 3-3"/>',
  phone: '<path d="M6 3.5h3.5l1.5 4.5-2.2 1.5a11 11 0 0 0 5.7 5.7l1.5-2.2 4.5 1.5V18a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4 6a2 2 0 0 1 2-2.5z"/>',
  back: '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
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

// Gemma only decides which price class the vehicle belongs to; the rupees come from real market rates.
// Letting a 4B model do the arithmetic gave ₹95, ₹180 and ₹600/hr for the same kind of vehicle.
const PRICE_SCHEMA = {
  type: 'object',
  properties: {
    tier: { type: 'string', enum: ['budget', 'standard', 'premium'] },
    reason: { type: 'string', maxLength: 220 },
  },
  required: ['tier', 'reason'],
};

// Hyderabad self-drive rental rates, checked Oct 2026 (ONN, GoWheelo, Boongg, Rentrip, Royal Brothers, Zoomcar,
// Revv, Zymo). The per-hour price is set a little below the commercial rate: a neighbour's vehicle comes with
// no company, no insurance package and no roadside help.
const TIERS = {
  Scooter: {
    market: 'Commercial scooter rentals start around ₹39/hr (₹350–550 per day)',
    budget: { examples: 'Scooty Pep, Dio, older or 100cc scooters', price: 30 },
    standard: { examples: 'Activa, Jupiter, Access 125, Fascino', price: 35 },
    premium: { examples: 'Ntorq, Aerox, Burgman, Ather, Ola, TVS iQube', price: 45 },
  },
  Bike: {
    market: 'Commercial commuter motorcycles rent for ₹29–35/hr; a Royal Enfield Classic 350 costs ₹900–1,500 per day',
    budget: { examples: 'Splendor, Platina, HF Deluxe, Shine 100', price: 25 },
    standard: { examples: 'Pulsar 150, Unicorn, FZ, Apache 160, Shine 125', price: 30 },
    premium: { examples: 'Royal Enfield, KTM Duke, Dominar, any 250cc and up', price: 100 },
  },
  Car: {
    market: 'Self-drive hatchbacks cost ₹45–100/hr on Revv, Zymo and Zoomcar; sedans and SUVs start around ₹95/hr',
    budget: { examples: 'Alto, Kwid, WagonR, S-Presso', price: 55 },
    standard: { examples: 'Swift, Baleno, i20, Tiago, Dzire', price: 70 },
    premium: { examples: 'City, Verna, Creta, Nexon, Brezza, any SUV', price: 95 },
  },
};

const hoursBetween = (from, to) => {
  const m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  const d = (m(to) - m(from) + 1440) % 1440;
  return Math.round((d / 60) * 2) / 2;
};
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

async function suggestPrice(l) {
  const t = TIERS[l.type] || TIERS.Scooter;
  const body = {
    model: settings.model,
    stream: false,
    format: PRICE_SCHEMA,
    // temperature 0 can loop forever inside JSON mode; a pinch of randomness plus a fixed seed keeps it steady.
    options: { temperature: 0.1, seed: 7, num_predict: 200 },
    messages: [{ role: 'user', content: `Put this ${l.type.toLowerCase()} into a rental price class for Hyderabad, India.
Vehicle: ${l.vehicle}

Classes:
- budget: ${t.budget.examples}
- standard: ${t.standard.examples}
- premium: ${t.premium.examples}
If the model is unknown or unclear, choose standard.
In reason, write one short plain sentence saying why, with no quotes.` }],
  };
  const t0 = performance.now();
  let out;
  for (let attempt = 1; !out; attempt++) {
    try {
      const r = await fetch(`${settings.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`Ollama said ${r.status}: ${await r.text()}`);
      const text = (await r.json()).message.content;
      try { out = JSON.parse(text); }
      catch { const m = text.match(/"tier"\s*:\s*"(budget|standard|premium)"/); if (!m) throw new Error('Gemma gave an unreadable answer'); out = { tier: m[1], reason: '' }; }
    } catch (e) {
      if (attempt >= 2) throw e;
      body.options.seed++;
    }
  }
  const price = t[out.tier]?.price ?? t.standard.price;
  const hours = hoursBetween(l.from, l.to);
  return {
    tier: out.tier, reason: out.reason, market: t.market, hours,
    price_per_hour: price, low: round5(price * 0.85), high: round5(price * 1.15),
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
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

// ------------------------------------------------------------------ server, dialogs, toasts

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${API}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(me ? { authorization: `Bearer ${me.token}` } : {}) },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && me && !path.startsWith('/auth')) { me = null; save('iw-session', null); renderAccount(); }
  if (!r.ok) throw new Error(data.error || `The server said ${r.status}`);
  return data;
}

// A modal form. Resolves with the form's fields, or null if closed.
function sheet(inner, submit, setup, cancel = 'Cancel') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'sheet';
    d.innerHTML = `<form method="dialog">${inner}
      <div class="row end"><button class="btn ghost" value="cancel" formnovalidate>${cancel}</button><button class="btn" value="ok">${submit}</button></div></form>`;
    document.body.append(d);
    d.addEventListener('close', () => {
      const data = d.returnValue === 'ok' ? Object.fromEntries(new FormData(d.querySelector('form')))
        : d.returnValue === 'alt' ? { _alt: true } : null;
      d.remove();
      resolve(data);
    });
    setup?.(d);
    d.showModal();
  });
}

function toast(msg, mood = 'happy') {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `${tyre(mood, 'xs')}<span>${esc(msg)}</span>`;
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

// Sign up or log in. Resolves with the logged-in user, or null if the person closes the form.
async function ensureMe(mode = 'signup') {
  if (me) return me;
  let err = '', phone = '';
  for (;;) {
    const signup = mode === 'signup';
    const f = await sheet(`
      <span class="eyebrow">${icon('user')} ${signup ? 'New here?' : 'Welcome back'}</span>
      <h2>${signup ? 'Create your account' : 'Log in'}</h2>
      <p class="muted small">${signup ? 'Your name is shown on your listings and requests. Your phone number is only shared after a booking is accepted.' : 'Use the phone number and password you signed up with, on any device.'}</p>
      ${err ? `<p class="form-err">${icon('alert', 'xs')} ${esc(err)}</p>` : ''}
      ${signup ? `<div class="field"><label for="nm">Your name</label><input id="nm" name="name" required maxlength="40" placeholder="Raga" autocomplete="name"></div>` : ''}
      <div class="field"><label for="ph">Phone number</label><input id="ph" name="phone" required inputmode="tel" pattern="[+0-9 ]{10,16}" placeholder="98765 43210" autocomplete="tel" value="${esc(phone)}"></div>
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" required minlength="${signup ? 6 : 1}" maxlength="200" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'At least 6 characters' : ''}"></div>
      <p class="small muted switch">${signup ? 'Already have an account?' : 'New to IdleWheels?'} <button class="linkish" value="alt" formnovalidate>${signup ? 'Log in' : 'Create an account'}</button></p>`,
    signup ? `${icon('check')} Create account` : `${icon('arrow')} Log in`);
    if (!f) return null;
    if (f._alt) { mode = signup ? 'login' : 'signup'; err = ''; continue; }
    try {
      const s = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: f });
      me = { token: s.token, ...s.user };
      save('iw-session', me);
      renderAccount(); refreshBadge();
      toast(signup ? `Welcome, ${me.name}!` : `Welcome back, ${me.name}!`, 'joy');
      return me;
    } catch (e) {
      err = e.message; phone = f.phone;
      if (/already has an account/.test(err)) mode = 'login';
    }
  }
}

const initial = (n) => esc(n.trim()[0]?.toUpperCase() || '?');
function renderAccount() {
  const a = $('#acct');
  a.classList.toggle('in', !!me);
  a.innerHTML = me ? `<span class="avatar">${initial(me.name)}</span><span class="acct-name">${esc(me.name)}</span>` : `${icon('user')}<span class="acct-name">Log in</span>`;
  a.setAttribute('aria-label', me ? `Account: ${me.name}` : 'Log in or sign up');
}

$('#acct').onclick = async () => {
  if (!me) {
    try { if (await ensureMe('login')) render(); } catch (e) { toast(e.message, 'worried'); }
    return;
  }
  const out = await sheet(`
    <div class="acct-card"><span class="avatar big">${initial(me.name)}</span>
      <div><h2>${esc(me.name)}</h2><p class="muted">${esc(me.phone)}</p></div></div>
    <p class="muted small">You're logged in on this device. Log in with the same phone number and password on any other phone or laptop to see your listings, bookings and chats there.</p>`,
  `${icon('back')} Log out`, null, 'Close');
  if (!out) return;
  try { await api('/auth/logout', { method: 'POST' }); } catch {}
  me = null; save('iw-session', null);
  renderAccount();
  $('#nav-badge').hidden = true;
  toast('Logged out. See you soon!');
  if (current === 'home') render(); else location.hash = 'home';
};

const photoSrc = (u) => (u?.startsWith('/api') ? API + u : u || '');

const waking = (what) => say('happy', `${what}…<span class="muted small">The first load can take up to a minute while the server wakes up.</span>`, 'rolling');
const fmtDay = (d) => new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const isoDay = (d) => d.toLocaleDateString('en-CA');

async function refreshBadge(list) {
  if (!me) return;
  try {
    list ??= await api('/bookings');
    const n = list.filter((b) => b.role === 'owner' && b.status === 'pending').length;
    const dot = $('#nav-badge');
    dot.hidden = !n; dot.textContent = n;
  } catch {}
}

// ------------------------------------------------------------------ routing

const views = {};
const main = $('#main');
const NAV = [
  ['home', 'home', 'Home', 'Home'], ['rent', 'plus', 'List vehicle', 'List'], ['bookings', 'chat', 'Bookings', 'Bookings'],
  ['check', 'shield', 'Damage check', 'Check'], ['setup', 'laptop', 'AI setup', 'AI'],
];
$('#tabs').innerHTML = NAV.map(([v, i, long, short]) => `<a href="#${v}" data-view="${v}">${icon(i)}<span class="l-long">${long}</span><span class="l-short">${short}</span>${v === 'bookings' ? '<i id="nav-badge" class="nav-badge" hidden></i>' : ''}</a>`).join('');
$('#logo').innerHTML = tyre('happy');
$('#foot').innerHTML = `${icon('lock', 'xs')} Handover photos never leave your devices and the AI runs on your own laptop. Phone numbers are shared only after a booking is accepted. · Demo photos from <a href="https://github.com/Raga-V/idlewheels/blob/main/CREDITS.md" target="_blank" rel="noopener">Wikimedia Commons</a> · <a href="https://github.com/Raga-V/idlewheels" target="_blank" rel="noopener">Source on GitHub</a>`;
renderAccount();
let current;
function render() {
  clearInterval(poll); poll = null;
  const [name, arg] = location.hash.slice(1).split('/');
  current = views[name] ? name : 'home';
  const tab = current === 'booking' ? 'bookings' : current;
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.view === tab));
  Promise.resolve(views[current](arg)).catch((e) => toast(e.message, 'worried'));
}
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

// ------------------------------------------------------------------ home

const step = (n, ic, tone, title, text) => `
  <article class="how-card">
    <div class="how-top"><span class="ib ${tone}">${icon(ic)}</span><span class="num">0${n}</span></div>
    <h3>${title}</h3><p class="muted">${text}</p>
  </article>`;

function listingCard(l) {
  const mine = me && l.owner_id === me.id;
  const photo = photoSrc(l.photo_url);
  return `
  <article class="listing">
    <div class="l-photo">
      ${photo ? `<img src="${esc(photo)}" alt="${esc(l.vehicle)}" loading="lazy">` : `<div class="l-ph">${icon(VEH_ICON[l.type] || 'scooter')}</div>`}
      ${l.demo ? '<span class="demo-tag">Demo</span>' : ''}
      <span class="price-tag">₹${esc(l.price)}<small>/hr</small></span>
      ${mine ? `<button class="icon-btn on-photo" data-del="${l.id}" title="Remove listing" aria-label="Remove ${esc(l.vehicle)}">${icon('trash')}</button>` : ''}
    </div>
    <div class="l-body">
      <div class="l-title"><span class="veh-ic">${icon(VEH_ICON[l.type] || 'scooter')}</span><h3>${esc(l.vehicle)}</h3></div>
      <p class="muted small">${icon('pin', 'xs')} ${esc(l.area || 'Nearby')} · by ${mine ? 'you' : esc(l.owner)}</p>
      <span class="tag">${icon('clock', 'xs')} Free ${esc(l.from)}–${esc(l.to)}</span>
      ${mine ? `<p class="muted small yours">Your listing. Requests show up in <a href="#bookings">Bookings</a>.</p>`
        : `<button class="btn sm wide" data-req="${l.id}">${icon('calendar')} Request to rent</button>`}
    </div>
  </article>`;
}

async function fillListings() {
  const box = $('#lst');
  try { listings = await api('/listings'); }
  catch (e) { if (box.isConnected) box.innerHTML = say('worried', `Couldn't load vehicles: ${esc(e.message)}`); return; }
  if (!box.isConnected) return;
  box.innerHTML = `<div class="listings">
    ${listings.map(listingCard).join('')}
    <a class="listing add" href="#rent">${icon('plus')}<span>${listings.length ? 'List your vehicle' : 'No vehicles yet. List the first one!'}</span></a>
  </div>`;
  box.querySelectorAll('[data-req]').forEach((b) => (b.onclick = () => requestListing(listings.find((l) => l.id === Number(b.dataset.req))).catch((e) => toast(e.message, 'worried'))));
  box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Remove this listing? Existing bookings stay in your Bookings tab.')) return;
    try { await api(`/listings/${b.dataset.del}`, { method: 'DELETE' }); fillListings(); } catch (e) { toast(e.message, 'worried'); }
  }));
}

async function requestListing(l) {
  if (!(await ensureMe())) return;
  const tomorrow = new Date(Date.now() + 864e5);
  const f = await sheet(`
    <span class="eyebrow">${icon(VEH_ICON[l.type] || 'scooter')} Request to rent</span>
    <h2>${esc(l.vehicle)}</h2>
    <p class="muted small">${esc(l.owner)} · ${esc(l.area || 'Nearby')} · ₹${esc(l.price)}/hr · free ${esc(l.from)}–${esc(l.to)}</p>
    <div class="field"><label for="rq-day">Day</label><input id="rq-day" type="date" name="day" required min="${isoDay(new Date())}" value="${isoDay(tomorrow)}"></div>
    <div class="field two">
      <div><label for="rq-from">From</label><input id="rq-from" type="time" name="from" required value="${esc(l.from)}" min="${esc(l.from)}" max="${esc(l.to)}"></div>
      <div><label for="rq-to">Until</label><input id="rq-to" type="time" name="to" required value="${esc(l.to)}" min="${esc(l.from)}" max="${esc(l.to)}"></div>
    </div>
    <div class="field"><label for="rq-note">Message to ${esc(l.owner)} <span class="muted">(optional)</span></label><input id="rq-note" name="note" maxlength="300" placeholder="Need it to get to college and back"></div>
    <p class="est" id="est"></p>`, `${icon('send')} Send request`, (d) => {
    const upd = () => {
      const h = hoursBetween(d.querySelector('[name=from]').value || l.from, d.querySelector('[name=to]').value || l.to);
      d.querySelector('#est').innerHTML = `${h} hours × ₹${esc(l.price)} = <b>₹${esc(Math.round(h * l.price))}</b> <span class="muted small">· pay the owner directly at pickup</span>`;
    };
    d.addEventListener('input', upd); upd();
  });
  if (!f) return;
  const b = await api('/bookings', { method: 'POST', body: { listing_id: l.id, ...f } });
  toast(`Request sent to ${l.owner}!`, 'joy');
  location.hash = `booking/${b.id}`;
}

views.home = () => {
  main.innerHTML = `
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">${icon('clock')} Rent out the hours you don't ride</span>
        <h1>Your scooter naps 9 hours a day. <em>Let it earn.</em></h1>
        <p class="lead">Neighbours rent each other's bikes and cars for the hours they sit parked. Request a slot, chat about pickup, and at every return a local AI compares photos and points out only the new scratches.</p>
        <div class="row">
          <button class="btn" id="find">${icon('search')} Find a vehicle</button>
          <a class="btn ghost" href="#rent">${icon('plus')} List my vehicle</a>
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
        ${step(1, 'clock', 'lilac', 'List the idle hours', 'Say when your vehicle is free. Gemma suggests a fair hourly price from real local rates.')}
        ${step(2, 'chat', 'brand', 'Request and chat', 'A neighbour picks a day and hours. Accept, and you both get each other\'s number and a chat to plan the pickup.')}
        ${step(3, 'camera', 'sun', 'Snap 4 photos at pickup', 'Front, left, right and rear. The renter snaps the same 4 when they bring it back.')}
        ${step(4, 'shield', 'mint', 'AI checks for new damage', 'Gemma on the owner\'s laptop lists only what is new. The report lands in your booking chat.')}
      </div>
    </section>

    <section class="section" id="near">
      <div class="sec-head"><h2 class="h2">Idle near you</h2><a href="#rent" class="link">List yours ${icon('arrow', 'xs')}</a></div>
      <div id="lst">${waking('Finding idle vehicles')}</div>
    </section>`;
  $('#find').onclick = () => $('#near').scrollIntoView({ behavior: 'smooth' });
  fillListings();
};

// ------------------------------------------------------------------ list a vehicle

views.rent = () => {
  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('plus')} Rent out</span>
      <h1>List your idle vehicle</h1>
      <p class="lead">Tell people nearby when it's free and what it costs. Requests show up in your Bookings tab.</p>
    </header>
    <section class="card form">
      <div class="field"><span class="lbl">What are you renting out?</span>
        <div class="seg" id="type">${Object.keys(VEH_ICON).map((t) => `<button type="button" data-t="${t}" class="${t === draftType ? 'on' : ''}">${icon(VEH_ICON[t])}<span>${t}</span></button>`).join('')}</div>
      </div>
      <div class="field"><span class="lbl">Photo <span class="muted">(optional, but renters trust listings with a photo)</span></span>
        <label class="photo-pick" id="ppick">${listingPhoto ? `<img src="${listingPhoto}" alt="Your vehicle">` : `<span class="slot-empty">${icon('camera')}<span>Add a photo of your vehicle</span></span>`}<input type="file" accept="image/*" id="pfile"></label>
      </div>
      <div class="grid2">
        <div class="field"><label for="v">Vehicle</label><input id="v" placeholder="Honda Activa 6G" maxlength="60"></div>
        <div class="field"><label for="a">Area</label><input id="a" placeholder="Bachupally" maxlength="60"></div>
        <div class="field"><label for="f">Free from</label><input id="f" type="time" value="09:30"></div>
        <div class="field"><label for="u">Until</label><input id="u" type="time" value="17:30"></div>
      </div>
      <div class="price-box">
        <div class="field"><label for="p">Price per hour</label><div class="prefix"><span>₹</span><input id="p" type="number" min="1" max="5000" value="35"></div></div>
        <button type="button" class="btn soft" id="ask">${icon('sparkle')} Ask Gemma for a fair price</button>
      </div>
      <div id="sugg"></div>
      <div class="row end">${me ? `<span class="muted small">Listing as ${esc(me.name)}</span>` : ''}<button class="btn" id="add">${icon('check')} Add listing</button></div>
    </section>
    <p class="note">${icon('help', 'xs')} <span>This is a demo. A real launch needs commercial (rental) registration and insurance; private-plate vehicles can't legally be rented out for money in India.</span></p>`;

  main.querySelectorAll('#type button').forEach((b) => (b.onclick = () => {
    draftType = b.dataset.t;
    main.querySelectorAll('#type button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const g = (id) => $(id).value.trim();
  $('#pfile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { listingPhoto = await downscale(f, 900); } catch { toast("Couldn't read that photo. Try a JPEG or PNG.", 'worried'); return; }
    $('#ppick').querySelector('img, .slot-empty').outerHTML = `<img src="${listingPhoto}" alt="Your vehicle">`;
  };
  $('#add').onclick = async () => {
    if (!g('#v')) return $('#v').focus();
    try {
      if (!(await ensureMe())) return;
      await api('/listings', { method: 'POST', body: { vehicle: g('#v'), type: draftType, area: g('#a'), from: g('#f'), to: g('#u'), price: Number(g('#p')), photo: listingPhoto } });
      listingPhoto = null;
      toast('Your vehicle is listed!', 'joy');
      location.hash = 'home';
    } catch (e) { toast(e.message, 'worried'); }
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
      sugg.innerHTML = say('joy', `<b class="say-big">₹${esc(s.price_per_hour)}/hr feels fair</b>
        <span class="muted small">Fair range ₹${esc(s.low)}–${esc(s.high)} · full ${esc(s.hours)}-hour window earns ₹${esc(Math.round(s.price_per_hour * s.hours))} · took ${esc(s.seconds)}s</span>
        <p>Gemma rates it <b>${esc(s.tier)}</b>. ${esc(s.reason)} ${esc(s.market)}, so a neighbour's vehicle should sit a little below that.</p>`);
    } catch (e) { sugg.innerHTML = say('worried', esc(e.message)); }
    $('#ask').disabled = false;
  };
};

// ------------------------------------------------------------------ bookings

const STATUS = {
  pending: ['sun', 'Waiting for reply'], accepted: ['mint', 'Confirmed'], declined: ['rose', 'Declined'],
  cancelled: ['grey', 'Cancelled'], completed: ['lilac', 'Returned'],
};
function statusChip(b) {
  const [tone, label] = STATUS[b.status] || STATUS.pending;
  return `<span class="st ${tone}">${b.status === 'pending' && b.role === 'owner' ? 'New request' : label}</span>`;
}

const bookingCard = (b) => `
  <a class="booking ${b.role === 'owner' && b.status === 'pending' ? 'needs' : ''}" href="#booking/${b.id}">
    ${b.photo_url ? `<img class="bk-thumb" src="${esc(photoSrc(b.photo_url))}" alt="">` : `<div class="veh-tile sm">${icon(VEH_ICON[b.type] || 'scooter')}</div>`}
    <div class="grow">
      <div class="bk-top"><h3>${esc(b.vehicle)}</h3>${statusChip(b)}</div>
      <p class="muted small">${icon('calendar', 'xs')} ${fmtDay(b.day)} · ${esc(b.from)}–${esc(b.to)} · ₹${esc(b.cost)} · ${b.role === 'owner' ? 'renter' : 'owner'} ${esc(b.other.name)}</p>
      ${b.last_message ? `<p class="small last">${esc(b.last_message)}</p>` : ''}
    </div>
    ${icon('arrow')}
  </a>`;

views.bookings = async () => {
  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('chat')} Bookings</span>
      <h1>Requests and rentals</h1>
      <p class="lead">Accept requests for your vehicle, plan pickups in the chat, and keep every handover report in one place.</p>
    </header>
    <div id="bk">${me ? waking('Loading your bookings') : say('happy', `Nothing here yet. <a href="#home">Request a vehicle</a> or <a href="#rent">list yours</a> to get started.`)}</div>`;
  if (!me) return;
  const box = $('#bk');
  let list;
  try { list = await api('/bookings'); } catch (e) { box.innerHTML = say('worried', esc(e.message)); return; }
  if (!box.isConnected) return;
  const owner = list.filter((b) => b.role === 'owner'), renter = list.filter((b) => b.role === 'renter');
  const section = (title, items, empty) => `<section class="bk-sec"><h2 class="h2">${title}</h2>
    ${items.length ? `<div class="bookings">${items.map(bookingCard).join('')}</div>` : `<p class="muted">${empty}</p>`}</section>`;
  box.innerHTML =
    section('Requests for your vehicles', owner, 'No requests yet. <a href="#rent">List a vehicle</a> and they will show up here.') +
    section('Your rentals', renter, 'You haven\'t requested anything yet. <a href="#home">Find a vehicle</a>.') +
    `<p class="note">${icon('user', 'xs')} <span>You're <b>${esc(me.name)}</b> (${esc(me.phone)}) on this browser.</span></p>`;
  refreshBadge(list);
};

function reportPill(r) {
  const mood = { ok: 'joy', bad: 'worried', unsure: 'unsure' }[r.verdict] || 'unsure';
  const dmg = (r.angles || []).flatMap((a) => (a.damage || []).map((d) =>
    `<li><span><b>${esc(a.angle)}</b> · ${esc(d.part)}<br><span class="muted small">${esc(d.description || d.kind)}</span></span><span class="sev ${esc(d.severity)}">${esc(d.severity)}</span></li>`));
  return `<div class="report-pill v-${esc(r.verdict)}">${tyre(mood, 'sm')}
    <div class="grow"><span class="eyebrow">AI handover report${r.by ? ` · run by ${esc(r.by)}` : ''}</span>
      <b class="rp-title">${esc(r.title)}</b>
      <span class="muted small">${(r.angles || []).map((a) => esc(a.angle)).join(', ')} checked by ${esc(r.model || 'Gemma')}${r.sample ? ' · sample photos' : ''}</span>
      ${dmg.length ? `<ul class="dmg">${dmg.join('')}</ul>` : ''}</div></div>`;
}

function message(m) {
  if (m.kind === 'system') return `<div class="msg sys">${esc(m.body)}</div>`;
  if (m.kind === 'report') { try { return `<div class="msg-report">${reportPill(JSON.parse(m.body))}</div>`; } catch { return ''; } }
  const at = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<div class="msg ${m.sender_id === me.id ? 'me' : 'them'}"><p>${esc(m.body)}</p><time>${at}</time></div>`;
}

function bookingHead(b) {
  const owner = b.role === 'owner', o = b.other, name = esc(o.name), veh = esc(b.vehicle);
  const guide = {
    pending: owner ? `<b>${name}</b> wants your ${veh}. Accept to share phone numbers, then plan the pickup in the chat below.`
      : `Request sent! Waiting for <b>${name}</b> to accept. You can already ask questions in the chat.`,
    accepted: `Confirmed! At pickup, open the <b>handover check</b> and snap the 4 pickup photos together. Snap the return photos when it comes back.`,
    declined: owner ? 'You declined this request.' : `${name} can't lend it this time. Try another vehicle on <a href="#home">Home</a>.`,
    cancelled: 'This booking was cancelled.',
    completed: 'Returned. Thanks for sharing wheels!',
  }[b.status];
  const mood = { pending: 'happy', accepted: 'joy', declined: 'unsure', cancelled: 'sleepy', completed: 'joy' }[b.status];
  const act = (status, label, cls = '', ic = '') => `<button class="btn ${cls}" data-status="${status}">${ic ? icon(ic) : ''}${label}</button>`;
  const acts = [];
  if (owner && b.status === 'pending') acts.push(act('accepted', 'Accept', '', 'check'), act('declined', 'Decline', 'ghost'));
  if (b.status === 'accepted') acts.push(`<a class="btn" href="#check/${b.id}">${icon('shield')} Start handover check</a>`);
  if (owner && b.status === 'accepted') acts.push(act('completed', 'Mark as returned', 'ghost', 'check'));
  if (!owner && (b.status === 'pending' || b.status === 'accepted')) acts.push(act('cancelled', b.status === 'pending' ? 'Cancel request' : 'Cancel booking', 'ghost'));
  const contact = o.demo
    ? `<span class="muted small">${icon('help', 'xs')} ${name} is a demo owner, so there's no real phone number. Real owners can be called or messaged on WhatsApp once they accept.</span>`
    : o.phone
    ? `<a class="btn ghost sm" href="tel:${esc(o.phone)}">${icon('phone')} Call ${name}</a>
       <a class="btn ghost sm" href="https://wa.me/${esc(o.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>`
    : `<span class="muted small">${icon('lock', 'xs')} Phone numbers are shared after the owner accepts</span>`;
  return `
    <section class="card bk-card">
      <div class="bk-title">
        ${b.photo_url ? `<img class="bk-photo" src="${esc(photoSrc(b.photo_url))}" alt="">` : `<div class="veh-tile">${icon(VEH_ICON[b.type] || 'scooter')}</div>`}
        <div class="grow"><span class="eyebrow">${owner ? 'Request for your vehicle' : o.demo ? 'Your rental · demo owner' : 'Your rental'}</span><h1>${veh}</h1></div>
        ${statusChip(b)}
      </div>
      <dl class="facts">
        <div><dt>Day</dt><dd>${fmtDay(b.day)}</dd></div>
        <div><dt>Time</dt><dd>${esc(b.from)}–${esc(b.to)}</dd></div>
        <div><dt>Cost</dt><dd>₹${esc(b.cost)} <span class="muted small">${esc(b.hours)} h × ₹${esc(b.price)}</span></dd></div>
        <div><dt>${owner ? 'Renter' : 'Owner'}</dt><dd>${name}</dd></div>
      </dl>
      <div class="row contact">${contact}</div>
      ${b.report ? reportPill(b.report) : ''}
    </section>
    ${say(mood, guide)}
    ${acts.length ? `<div class="row actions">${acts.join('')}</div>` : ''}`;
}

views.booking = async (id) => {
  if (!me) { location.hash = 'bookings'; return; }
  main.innerHTML = `
    <a class="back" href="#bookings">${icon('back')} All bookings</a>
    <div id="bk-head">${waking('Opening the booking')}</div>
    <section class="card chat" id="chat">
      <h2 class="h3">${icon('chat')} Chat</h2>
      <div class="msgs" id="msgs"></div>
      <form id="send" class="send"><input name="body" placeholder="Write a message…" autocomplete="off" maxlength="1000" aria-label="Message"><button class="btn" aria-label="Send">${icon('send')}</button></form>
    </section>`;
  let lastId = 0;
  const head = async () => {
    const b = await api(`/bookings/${id}`);
    const box = $('#bk-head');
    if (!box) return;
    box.innerHTML = bookingHead(b);
    $('#send').hidden = b.status === 'declined' || b.status === 'cancelled';
    box.querySelectorAll('[data-status]').forEach((x) => (x.onclick = async () => {
      const s = x.dataset.status;
      if ((s === 'declined' || s === 'cancelled') && !confirm(s === 'declined' ? 'Decline this request?' : 'Cancel this booking?')) return;
      x.disabled = true;
      try { await api(`/bookings/${id}/status`, { method: 'POST', body: { status: s } }); await head(); await pull(); refreshBadge(); }
      catch (e) { toast(e.message, 'worried'); x.disabled = false; }
    }));
  };
  const pull = async (first = false) => {
    const msgs = await api(`/bookings/${id}/messages?after=${lastId}`);
    const box = $('#msgs');
    if (!msgs.length || !box) return;
    lastId = msgs.at(-1).id;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.insertAdjacentHTML('beforeend', msgs.map(message).join(''));
    if (first || nearBottom) box.scrollTop = box.scrollHeight;
    // Status changes and reports arrive as messages; refresh the header when the other person acts.
    if (!first && msgs.some((m) => m.kind !== 'text')) await head();
  };
  try { await head(); await pull(true); }
  catch (e) { $('#bk-head').innerHTML = say('worried', esc(e.message)); $('#chat').remove(); return; }
  poll = setInterval(() => pull().catch(() => {}), 4000);
  $('#send').onsubmit = async (e) => {
    e.preventDefault();
    const inp = e.target.elements.body, v = inp.value.trim();
    if (!v) return;
    inp.value = '';
    try { await api(`/bookings/${id}/messages`, { method: 'POST', body: { body: v } }); await pull(); }
    catch (err) { toast(err.message, 'worried'); inp.value = v; }
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

views.check = async (bookingId) => {
  const key = `iw-shots-${bookingId || 'free'}`;
  if (key !== shotsKey) { shotsKey = key; shots = load(key, { before: {}, after: {} }); results = null; }
  checkBooking = null;
  if (bookingId && me) {
    main.innerHTML = waking('Opening the booking');
    try { checkBooking = await api(`/bookings/${bookingId}`); } catch (e) { toast(e.message, 'worried'); }
  }
  drawCheck();
};

function drawCheck() {
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
  const b = checkBooking;

  main.innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${icon('shield')} Handover check</span>
      <h1>Settle "that scratch was already there"</h1>
      <p class="lead">Photos at pickup, photos at return. Gemma on your laptop spots what's new.</p>
    </header>
    ${b ? `<a class="for-booking" href="#booking/${b.id}">${icon('chat')}<span>For the booking with <b>${esc(b.other.name)}</b> · ${fmtDay(b.day)}, ${esc(b.from)}–${esc(b.to)}. The report will be posted in your chat.</span>${icon('arrow', 'xs')}</a>` : ''}
    <ol class="stepper">${stepLi(1, 'Pickup photos')}${stepLi(2, 'Return photos')}${stepLi(3, 'AI report')}</ol>
    ${guide ? say('happy', guide) : ''}
    ${!nb && !na ? `<section class="card sample noprint">
      <img src="demo/check/after-right.jpg" alt="" class="sample-img">
      <div class="grow"><h3>No vehicle handy?</h3>
        <p class="muted small">Load sample photos of a Honda Activa: 4 at pickup and 4 at return. One side came back with a strip of tape and a scratch. See if Gemma finds it.</p></div>
      <button class="btn soft" id="sample">${icon('camera')} Use sample photos</button>
    </section>` : ''}
    <section class="card veh-row">
      <label for="veh">${icon('scooter')} Vehicle</label>
      <input id="veh" value="${esc(b?.vehicle || checkVeh)}" placeholder="Honda Activa 6G" maxlength="60" ${b ? 'readonly' : ''}>
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

  $('#veh').onchange = () => { checkVeh = $('#veh').value.trim(); save('iw-veh', checkVeh); };
  main.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { shots[inp.dataset.phase][inp.dataset.angle] = await downscale(f); }
    catch { toast("Couldn't read that photo. Try a JPEG or PNG.", 'worried'); return; }
    keepShots(); results = null; drawCheck();
  }));
  $('#reset').onclick = () => { shots = { before: {}, after: {} }; keepShots(); results = null; drawCheck(); };
  $('#sample')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const file = { Front: 'front', 'Left side': 'left', 'Right side': 'right', Rear: 'rear' };
    try {
      for (const a of ANGLES) {
        for (const phase of ['before', 'after']) {
          const r = await fetch(`demo/check/${phase}-${file[a]}.jpg`);
          if (!r.ok) throw new Error(`Couldn't load the sample photos (${r.status})`);
          shots[phase][a] = await downscale(await r.blob());
        }
      }
      shots.sample = true;
      if (!checkBooking) { checkVeh = 'Honda Activa (sample photos)'; save('iw-veh', checkVeh); }
      keepShots(); results = null; drawCheck();
    } catch (err) { toast(err.message, 'worried'); e.target.disabled = false; }
  });
  $('#print')?.addEventListener('click', () => window.print());
  $('#run').onclick = async () => {
    const prog = $('#prog');
    if (!(await aiStatus())) { prog.innerHTML = say('sleepy', `I can't reach Gemma on this laptop. Open <a href="#setup">AI setup</a> to wake me up.`); return; }
    const veh = $('#veh').value.trim(); const res = { vehicle: veh, at: new Date(), angles: [] };
    $('#run').disabled = true;
    for (const [i, a] of ready.entries()) {
      prog.innerHTML = say('happy', `Comparing the <b>${a.toLowerCase()}</b> photos… (${i + 1} of ${ready.length})`, 'rolling');
      try { res.angles.push({ angle: a, ...(await checkAngle(a, veh)) }); }
      catch (e) { res.angles.push({ angle: a, verdict: 'unsure', error: e.message, new_damage: [] }); }
    }
    results = res;
    if (checkBooking) await shareReport(res);
    drawCheck();
    $('#out').scrollIntoView({ behavior: 'smooth' });
  };
}

// Only the verdicts and damage notes go to the booking; the photos stay here.
async function shareReport(r) {
  const [verdict, , title] = overall(r);
  try {
    await api(`/bookings/${checkBooking.id}/report`, {
      method: 'POST',
      body: {
        verdict, title, model: settings.model, sample: !!shots.sample,
        angles: r.angles.map((a) => ({ angle: a.angle, verdict: a.error ? 'error' : a.verdict, damage: a.new_damage || [] })),
      },
    });
    r.shared = true;
    toast(`Report posted in your chat with ${checkBooking.other.name}`, 'joy');
  } catch (e) { toast(`Couldn't post the report: ${e.message}`, 'worried'); }
}

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
    <p class="muted small meta">${r.at.toLocaleString()} · checked by ${esc(settings.model)} running on this laptop${r.shared && checkBooking ? ` · <a href="#booking/${checkBooking.id}">posted in your chat with ${esc(checkBooking.other.name)}</a>` : ''}</p>
    ${shots.sample ? `<p class="answer">${icon('help', 'xs')} <span><b>Answer key for the sample photos:</b> only the <b>right side</b> has new damage, a strip of tape and a scratch on the side panel. The other three angles are unchanged retakes with different light. Compare that with what Gemma said above.</span></p>` : ''}
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
refreshBadge();
setInterval(() => refreshBadge(), 30000);
