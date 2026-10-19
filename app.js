// IdleWheels: rent out your idle vehicle; a local Gemma checks every handover for new damage.
// No backend. Listings live in this browser; photos go only to the Ollama server you point it at (your laptop).

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const ANGLES = ['Front', 'Left side', 'Right side', 'Rear'];
let settings = { url: 'http://localhost:11434', model: 'gemma3:4b', ...load('iw-settings', {}) };
let listings = load('iw-listings', [
  { id: 'demo1', owner: 'Dad', vehicle: 'Honda Activa 6G', type: 'Scooter', area: 'Bachupally', from: '09:30', to: '17:30', price: 40 },
]);
const shots = { before: {}, after: {} };   // angle -> dataURL (downscaled)
let results = null;

// ------------------------------------------------------------------ Ollama

async function aiStatus() {
  const pill = $('#ai-status');
  try {
    const r = await fetch(`${settings.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const tags = (await r.json()).models?.map((m) => m.name) || [];
    const has = tags.some((t) => t.startsWith(settings.model));
    pill.textContent = has ? `AI: ${settings.model} ready` : `AI: ${settings.model} not pulled`;
    pill.className = 'pill ' + (has ? 'ok' : 'bad');
    return has;
  } catch {
    pill.textContent = 'AI: laptop not reachable';
    pill.className = 'pill bad';
    return false;
  }
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

// ------------------------------------------------------------------ views

const views = {};
const main = $('#main');
function show(v) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  views[v]();
}
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

function slots(phase) {
  return `<div class="grid">${ANGLES.map((a) => `
    <div class="slot">
      ${shots[phase][a] ? `<img src="${shots[phase][a]}" alt="${phase} ${a}">` : `<div class="ph">📷</div>`}
      <b>${a}</b>
      <label class="pick">${shots[phase][a] ? 'Retake' : 'Add photo'}
        <input type="file" accept="image/*" capture="environment" data-phase="${phase}" data-angle="${a}"></label>
    </div>`).join('')}</div>`;
}

views.check = () => {
  const vehicle = $('#veh')?.value || listings[0]?.vehicle || '';
  const nb = Object.keys(shots.before).length, na = Object.keys(shots.after).length;
  const ready = ANGLES.filter((a) => shots.before[a] && shots.after[a]);
  main.innerHTML = `
    <section class="card hero">
      <h1>"That scratch was already there."</h1>
      <p>Every vehicle rental ends in this argument. IdleWheels settles it. Take photos at handover and again at return, and Gemma on your own laptop spots what's new. No cloud, no upload, ₹0 per check.</p>
    </section>
    <div class="steps"><span class="${nb ? 'on' : ''}">1 · Handover photos</span><span class="${na ? 'on' : ''}">2 · Return photos</span><span class="${results ? 'on' : ''}">3 · AI check</span></div>
    <section class="card">
      <label for="veh">Vehicle</label>
      <select id="veh">${listings.map((l) => `<option ${l.vehicle === vehicle ? 'selected' : ''}>${esc(l.vehicle)}</option>`).join('')}</select>
    </section>
    <section class="card"><h2>1 · At handover (owner)</h2><p class="muted small">Same 4 angles every time. Stand about 2 m away.</p>${slots('before')}</section>
    <section class="card"><h2>2 · At return (renter)</h2><p class="muted small">Match the handover angles as closely as you can.</p>${slots('after')}</section>
    <section class="card noprint">
      <div class="row"><button class="btn" id="run" ${ready.length ? '' : 'disabled'}>🔍 Check ${ready.length || ''} angle${ready.length === 1 ? '' : 's'} for new damage</button>
      <button class="btn ghost" id="reset">Start over</button></div>
      <p id="prog" class="muted small"></p>
    </section>
    <div id="out">${results ? report(results) : ''}</div>`;

  main.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    shots[inp.dataset.phase][inp.dataset.angle] = await downscale(f);
    results = null; views.check();
  }));
  $('#reset').onclick = () => { shots.before = {}; shots.after = {}; results = null; views.check(); };
  $('#run').onclick = async () => {
    if (!(await aiStatus())) { $('#prog').innerHTML = '⚠️ Gemma isn\'t reachable. Open the <b>Setup</b> tab.'; return; }
    const veh = $('#veh').value; const res = { vehicle: veh, at: new Date(), angles: [] };
    $('#run').disabled = true;
    for (const [i, a] of ready.entries()) {
      $('#prog').innerHTML = `<span class="spin"></span>Gemma is comparing the ${a.toLowerCase()} photos (${i + 1}/${ready.length})…`;
      try { res.angles.push({ angle: a, ...(await checkAngle(a, veh)) }); }
      catch (e) { res.angles.push({ angle: a, verdict: 'unsure', error: e.message, new_damage: [] }); }
    }
    results = res; $('#prog').textContent = ''; views.check();
    $('#out').scrollIntoView({ behavior: 'smooth' });
  };
};

function overall(r) {
  if (r.angles.some((a) => a.verdict === 'new_damage')) return ['bad', '⚠️ New damage found at return'];
  if (r.angles.some((a) => a.verdict === 'unsure')) return ['unsure', '🤔 Not sure on some angles. Take a closer look together.'];
  return ['ok', '✅ No new damage. Hand back the deposit.'];
}

function report(r) {
  const [cls, text] = overall(r);
  return `<section class="card report">
    <h2>Handover report · ${esc(r.vehicle)}</h2>
    <p class="muted small">${r.at.toLocaleString()} · checked by ${esc(settings.model)} running locally</p>
    <div class="verdict ${cls}">${text}</div>
    ${r.angles.map((a) => `
      <div class="card">
        <div class="row" style="justify-content:space-between"><b>${esc(a.angle)}</b>
          <span class="muted small">${a.error ? 'error' : `${a.verdict.replaceAll('_', ' ')} · confidence ${Math.round((a.confidence || 0) * 100)}% · ${a.seconds}s`}</span></div>
        <div class="pair"><div><img src="${shots.before[a.angle]}" alt=""><div class="cap">Handover</div></div><div><img src="${shots.after[a.angle]}" alt=""><div class="cap">Return</div></div></div>
        ${a.error ? `<p class="verdict unsure">${esc(a.error)}</p>` : ''}
        ${a.same_vehicle_and_angle === false ? `<p class="verdict unsure">These two photos don't look like the same view. Retake the return photo.</p>` : ''}
        ${a.new_damage?.length ? `<ul class="dmg">${a.new_damage.map((d) => `<li><b>${esc(d.part)}</b>: ${esc(d.kind)}, ${esc(d.description)}<span class="sev ${esc(d.severity)}">${esc(d.severity)}</span></li>`).join('')}</ul>` : (a.error ? '' : '<p class="muted small">Nothing new spotted.</p>')}
      </div>`).join('')}
    <div class="row noprint"><button class="btn" onclick="window.print()">🖨️ Save report as PDF</button>
    <span class="muted small">Both of you keep a copy. That's the whole dispute process.</span></div>
  </section>`;
}

views.listings = () => {
  main.innerHTML = `
    <section class="card hero">
      <h1>Your bike is idle 9 hours a day.</h1>
      <p>Students and office-goers park and forget. Someone nearby needs wheels for exactly those hours. List the window, set a price, and every handover is checked by AI.</p>
    </section>
    ${listings.map((l) => `
      <section class="card listing">
        <div><h2>${l.type === 'Car' ? '🚗' : l.type === 'Bike' ? '🏍️' : '🛵'} ${esc(l.vehicle)}</h2>
        <div class="muted small">${esc(l.owner)} · ${esc(l.area)} · free ${esc(l.from)}–${esc(l.to)}</div></div>
        <div style="text-align:right"><div class="price">₹${esc(l.price)}<span class="small muted">/hr</span></div>
        <button class="btn ghost small" data-del="${esc(l.id)}">Remove</button></div>
      </section>`).join('')}
    <section class="card"><h2>List your idle vehicle</h2>
      <div class="grid">
        <div><label>Your name</label><input id="o" placeholder="Raga"></div>
        <div><label>Vehicle</label><input id="v" placeholder="TVS Jupiter"></div>
        <div><label>Type</label><select id="t"><option>Scooter</option><option>Bike</option><option>Car</option></select></div>
        <div><label>Area</label><input id="a" placeholder="Bachupally"></div>
        <div><label>Idle from</label><input id="f" type="time" value="09:30"></div>
        <div><label>Idle until</label><input id="u" type="time" value="17:30"></div>
        <div><label>₹ per hour</label><input id="p" type="number" min="0" value="40"></div>
      </div>
      <p class="row"><button class="btn" id="add">Add listing</button><button class="btn ghost" id="ask">✨ Ask Gemma for a fair price</button></p>
      <p id="sugg" class="muted small"></p>
      <p class="muted small">Listings are saved in this browser only. This is a demo. A real launch needs commercial (rental) registration and insurance; private-plate vehicles can't legally be rented out for money in India.</p>
    </section>`;
  main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { listings = listings.filter((l) => l.id !== b.dataset.del); save('iw-listings', listings); views.listings(); }));
  $('#add').onclick = () => {
    const g = (id) => $(id).value.trim();
    if (!g('#v')) return $('#v').focus();
    listings.push({ id: crypto.randomUUID?.() || String(Date.now()), owner: g('#o') || 'Me', vehicle: g('#v'), type: g('#t'), area: g('#a'), from: g('#f'), to: g('#u'), price: g('#p') });
    save('iw-listings', listings); views.listings();
  };
  $('#ask').onclick = async () => {
    const g = (id) => $(id).value.trim();
    if (!g('#v')) return $('#v').focus();
    const sugg = $('#sugg');
    if (!(await aiStatus())) { sugg.innerHTML = '⚠️ Gemma isn\'t reachable. Open the <b>Setup</b> tab.'; return; }
    $('#ask').disabled = true;
    sugg.innerHTML = '<span class="spin"></span>Gemma is thinking about a fair price…';
    try {
      const s = await suggestPrice({ vehicle: g('#v'), type: g('#t'), area: g('#a'), from: g('#f'), to: g('#u') });
      $('#p').value = Math.round(s.price_per_hour);
      sugg.innerHTML = `<b>Gemma suggests ₹${esc(Math.round(s.price_per_hour))}/hr</b> (fair range ₹${esc(Math.round(s.low))}–${esc(Math.round(s.high))}) · ${esc(s.seconds)}s<br>${esc(s.reasoning)}`;
    } catch (e) { sugg.textContent = '⚠️ ' + e.message; }
    $('#ask').disabled = false;
  };
};

views.settings = () => {
  main.innerHTML = `
    <section class="card"><h2>Run the AI on your own laptop</h2>
      <ol>
        <li>Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, then run <code>ollama pull gemma3:4b</code></li>
        <li>Allow this site to talk to it: <code>setx OLLAMA_ORIGINS "*"</code> (Windows) or <code>OLLAMA_ORIGINS="*" ollama serve</code> (Mac/Linux), then restart Ollama.</li>
        <li>Open this page on the same laptop. The pill at the top turns green.</li>
      </ol>
      <label>Ollama address</label><input id="url" value="${esc(settings.url)}">
      <label>Model</label><input id="model" value="${esc(settings.model)}">
      <p class="row"><button class="btn" id="saveS">Save & test</button><span id="st" class="muted small"></span></p>
    </section>
    <section class="card"><h2>Why local?</h2>
      <p class="muted">Vehicle photos show number plates, homes and faces. They stay between the owner, the renter and the owner's own laptop. Every check costs ₹0, so you can check every single handover, and you can swap in a bigger model (<code>gemma3:12b</code>) any time.</p>
    </section>`;
  $('#saveS').onclick = async () => {
    settings = { url: $('#url').value.trim().replace(/\/$/, ''), model: $('#model').value.trim() };
    save('iw-settings', settings);
    $('#st').textContent = (await aiStatus()) ? '✅ Connected' : '❌ Not reachable. Check step 2 and that Ollama is running.';
  };
};

show('check');
aiStatus();
