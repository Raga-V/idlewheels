// IdleWheels server: shared listings, booking requests and chat.
// Photos and the AI never touch it; the damage check still runs on the owner's laptop.
// Uses Postgres when DATABASE_URL is set (Render), otherwise PGlite (Postgres in WASM) for local runs.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT) || 8000;
const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
// The GitHub Pages copy of the app talks to this server too.
const CORS_ORIGINS = new Set(['https://raga-v.github.io', ...(process.env.EXTRA_ORIGINS || '').split(',').filter(Boolean)]);

// ------------------------------------------------------------------ database

async function connect() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg');
    const external = /\.render\.com/.test(process.env.DATABASE_URL);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: external ? { rejectUnauthorized: false } : false });
    return (text, params) => pool.query(text, params);
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(process.env.PGLITE_DIR || undefined);
  return (text, params) => db.query(text, params);
}

const SCHEMA = [
  `create table if not exists users (
    id serial primary key, name text not null, phone text not null, key text unique not null,
    created_at timestamptz not null default now())`,
  `create table if not exists listings (
    id serial primary key, owner_id int not null references users(id), vehicle text not null, type text not null,
    area text not null default '', from_time text not null, to_time text not null, price int not null,
    active boolean not null default true, created_at timestamptz not null default now())`,
  `create table if not exists bookings (
    id serial primary key, listing_id int not null references listings(id), renter_id int not null references users(id),
    day text not null, from_time text not null, to_time text not null, note text not null default '',
    status text not null default 'pending', report jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  `create table if not exists messages (
    id serial primary key, booking_id int not null references bookings(id), sender_id int references users(id),
    kind text not null default 'text', body text not null, created_at timestamptz not null default now())`,
  `create index if not exists messages_by_booking on messages(booking_id, id)`,
];

const q = await connect();
for (const s of SCHEMA) await q(s);

// ------------------------------------------------------------------ helpers

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

function text(v, max, name, optional = false) {
  const s = String(v ?? '').trim();
  if (!s && !optional) fail(400, `${name} is required`);
  if (s.length > max) fail(400, `${name} is too long`);
  return s;
}
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (v, name) => (TIME.test(v) ? v : fail(400, `${name} must be a time like 09:30`));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hours = (from, to) => Math.round((((minutes(to) - minutes(from) + 1440) % 1440) / 60) * 2) / 2;

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 64 * 1024) fail(413, 'Request too large'); chunks.push(c); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
}

async function auth(req) {
  const key = req.headers['x-user-key'];
  if (!key) fail(401, 'Tell us who you are first');
  const { rows } = await q('select id, name, phone from users where key = $1', [key]);
  return rows[0] || fail(401, 'Unknown user. Please enter your name again.');
}

const BOOKING_SQL = `
  select b.id, b.listing_id, b.renter_id, b.day, b.from_time as "from", b.to_time as "to", b.note, b.status, b.report,
         b.created_at, b.updated_at, l.vehicle, l.type, l.area, l.price, l.owner_id,
         o.name as owner_name, o.phone as owner_phone, r.name as renter_name, r.phone as renter_phone,
         (select case when m.kind = 'report' then 'AI handover report' else m.body end
            from messages m where m.booking_id = b.id order by m.id desc limit 1) as last_message
    from bookings b
    join listings l on l.id = b.listing_id
    join users o on o.id = l.owner_id
    join users r on r.id = b.renter_id`;

// Phone numbers are only shared once the owner has accepted.
function shape(b, user) {
  const role = b.owner_id === user.id ? 'owner' : 'renter';
  const shared = b.status === 'accepted' || b.status === 'completed';
  const other = role === 'owner' ? { name: b.renter_name, phone: b.renter_phone } : { name: b.owner_name, phone: b.owner_phone };
  if (!shared) delete other.phone;
  const { owner_phone, renter_phone, owner_name, renter_name, ...rest } = b;
  return { ...rest, role, other, hours: hours(b.from, b.to), cost: Math.round(hours(b.from, b.to) * b.price) };
}

async function bookingFor(id, user) {
  const { rows } = await q(`${BOOKING_SQL} where b.id = $1`, [id]);
  const b = rows[0];
  if (!b || (b.renter_id !== user.id && b.owner_id !== user.id)) fail(404, 'Booking not found');
  return shape(b, user);
}

const systemMessage = (bookingId, body) => q(`insert into messages (booking_id, kind, body) values ($1, 'system', $2)`, [bookingId, body]);
const touch = (bookingId) => q('update bookings set updated_at = now() where id = $1', [bookingId]);

async function clashes(listingId, day, from, to, exceptId = 0) {
  const { rows } = await q(
    `select 1 from bookings where listing_id = $1 and day = $2 and status = 'accepted' and id <> $5
       and not (to_time <= $3 or from_time >= $4) limit 1`, [listingId, day, from, to, exceptId]);
  return rows.length > 0;
}

// ------------------------------------------------------------------ routes

const routes = [];
const route = (method, path, fn) => routes.push([method, new RegExp('^' + path.replace(/:id/g, '(\\d+)') + '$'), fn]);

route('GET', '/api/health', async () => ({ ok: true }));

route('POST', '/api/users', async ({ body }) => {
  const name = text(body.name, 40, 'Name');
  const phone = String(body.phone ?? '').replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,13}$/.test(phone)) fail(400, 'Enter a valid phone number');
  const key = randomBytes(24).toString('base64url');
  const { rows } = await q('insert into users (name, phone, key) values ($1, $2, $3) returning id, name, phone, key', [name, phone, key]);
  return rows[0];
});

route('GET', '/api/me', async ({ req }) => auth(req));

route('GET', '/api/listings', async () => {
  const { rows } = await q(`
    select l.id, l.vehicle, l.type, l.area, l.from_time as "from", l.to_time as "to", l.price, l.owner_id, u.name as owner
      from listings l join users u on u.id = l.owner_id
     where l.active order by l.created_at desc limit 200`);
  return rows;
});

route('POST', '/api/listings', async ({ req, body }) => {
  const user = await auth(req);
  const type = ['Scooter', 'Bike', 'Car'].includes(body.type) ? body.type : fail(400, 'Pick scooter, bike or car');
  const price = Math.round(Number(body.price));
  if (!(price > 0 && price <= 5000)) fail(400, 'Price must be between ₹1 and ₹5,000 an hour');
  const { rows } = await q(
    `insert into listings (owner_id, vehicle, type, area, from_time, to_time, price) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [user.id, text(body.vehicle, 60, 'Vehicle'), type, text(body.area, 60, 'Area', true), time(body.from, 'Free from'), time(body.to, 'Until'), price]);
  return rows[0];
});

route('DELETE', '/api/listings/:id', async ({ req, id }) => {
  const user = await auth(req);
  const r = await q('update listings set active = false where id = $1 and owner_id = $2', [id, user.id]);
  if (!r.rowCount && !r.affectedRows) fail(404, 'Listing not found');
  return { ok: true };
});

route('POST', '/api/bookings', async ({ req, body }) => {
  const user = await auth(req);
  const { rows: [l] } = await q('select * from listings where id = $1 and active', [Number(body.listing_id)]);
  if (!l) fail(404, 'This vehicle is no longer listed');
  if (l.owner_id === user.id) fail(400, "That's your own vehicle");
  const day = DAY.test(body.day) ? body.day : fail(400, 'Pick a day');
  const from = time(body.from, 'From'), to = time(body.to, 'Until');
  if (minutes(to) <= minutes(from)) fail(400, '"Until" must be after "From"');
  if (minutes(from) < minutes(l.from_time) || minutes(to) > minutes(l.to_time)) fail(400, `It's only free ${l.from_time}–${l.to_time}`);
  if (await clashes(l.id, day, from, to)) fail(409, 'Someone already booked part of that time');
  const note = text(body.note, 300, 'Message', true);
  const { rows: [b] } = await q(
    'insert into bookings (listing_id, renter_id, day, from_time, to_time, note) values ($1, $2, $3, $4, $5, $6) returning id',
    [l.id, user.id, day, from, to, note]);
  await systemMessage(b.id, `${user.name} asked to rent the ${l.vehicle} on ${day}, ${from}–${to}.`);
  if (note) await q('insert into messages (booking_id, sender_id, body) values ($1, $2, $3)', [b.id, user.id, note]);
  return b;
});

route('GET', '/api/bookings', async ({ req }) => {
  const user = await auth(req);
  const { rows } = await q(`${BOOKING_SQL} where b.renter_id = $1 or l.owner_id = $1 order by b.updated_at desc limit 100`, [user.id]);
  return rows.map((b) => shape(b, user));
});

route('GET', '/api/bookings/:id', async ({ req, id }) => bookingFor(id, await auth(req)));

const MOVES = {
  owner: { pending: ['accepted', 'declined'], accepted: ['completed'] },
  renter: { pending: ['cancelled'], accepted: ['cancelled'] },
};
const MOVE_TEXT = { accepted: 'accepted the request. Phone numbers are now shared.', declined: 'declined the request.', cancelled: 'cancelled the booking.', completed: 'marked the rental as done.' };

route('POST', '/api/bookings/:id/status', async ({ req, id, body }) => {
  const user = await auth(req);
  const b = await bookingFor(id, user);
  if (!(MOVES[b.role][b.status] || []).includes(body.status)) fail(400, `Can't change a ${b.status} booking to ${body.status}`);
  if (body.status === 'accepted' && (await clashes(b.listing_id, b.day, b.from, b.to, b.id))) fail(409, 'You already accepted another booking for that time');
  await q('update bookings set status = $1, updated_at = now() where id = $2', [body.status, id]);
  await systemMessage(id, `${user.name} ${MOVE_TEXT[body.status]}`);
  return bookingFor(id, user);
});

route('GET', '/api/bookings/:id/messages', async ({ req, id, url }) => {
  await bookingFor(id, await auth(req));
  const after = Number(url.searchParams.get('after')) || 0;
  const { rows } = await q(
    'select id, sender_id, kind, body, created_at from messages where booking_id = $1 and id > $2 order by id limit 200', [id, after]);
  return rows;
});

route('POST', '/api/bookings/:id/messages', async ({ req, id, body }) => {
  const user = await auth(req);
  const b = await bookingFor(id, user);
  if (b.status === 'declined' || b.status === 'cancelled') fail(400, 'This booking is closed');
  const { rows: [m] } = await q(
    'insert into messages (booking_id, sender_id, body) values ($1, $2, $3) returning id, sender_id, kind, body, created_at',
    [id, user.id, text(body.body, 1000, 'Message')]);
  await touch(id);
  return m;
});

// The AI report summary (verdicts and damage notes, never the photos) is pinned to the booking and posted in the chat.
route('POST', '/api/bookings/:id/report', async ({ req, id, body }) => {
  const user = await auth(req);
  await bookingFor(id, user);
  const angles = Array.isArray(body.angles) ? body.angles.slice(0, 4) : fail(400, 'Missing angles');
  const report = {
    verdict: ['ok', 'bad', 'unsure'].includes(body.verdict) ? body.verdict : 'unsure',
    title: text(body.title, 80, 'Title'),
    model: text(body.model, 40, 'Model', true),
    by: user.name,
    angles: angles.map((a) => ({
      angle: text(a.angle, 20, 'Angle'),
      verdict: text(a.verdict, 20, 'Verdict'),
      damage: (Array.isArray(a.damage) ? a.damage.slice(0, 10) : []).map((d) => ({
        part: text(d.part, 60, 'Part', true), kind: text(d.kind, 30, 'Kind', true),
        description: text(d.description, 300, 'Description', true), severity: text(d.severity, 10, 'Severity', true),
      })),
    })),
  };
  await q('update bookings set report = $1, updated_at = now() where id = $2', [JSON.stringify(report), id]);
  await q(`insert into messages (booking_id, sender_id, kind, body) values ($1, $2, 'report', $3)`, [id, user.id, JSON.stringify(report)]);
  return { ok: true };
});

// ------------------------------------------------------------------ server

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type, x-user-key');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('vary', 'origin');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  if (!url.pathname.startsWith('/api/')) {
    const file = STATIC[url.pathname];
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) return res.writeHead(404).end('Not found');
    const data = await readFile(join(ROOT, file[0]));
    return res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-cache' }).end(data);
  }

  const send = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
  try {
    for (const [method, re, fn] of routes) {
      const m = req.method === method && url.pathname.match(re);
      if (!m) continue;
      const body = method === 'POST' ? await readBody(req) : {};
      return send(200, await fn({ req, url, body, id: m[1] && Number(m[1]) }));
    }
    send(404, { error: 'Not found' });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the server' });
  }
}).listen(PORT, () => console.log(`IdleWheels on http://localhost:${PORT}`));
