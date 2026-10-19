// End-to-end check of the server: sign up and log in, list, request, accept, chat, attach a report,
// plus the demo listings. Runs against a throwaway in-memory database: `npm test`.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, PORT: String(PORT) };
delete env.DATABASE_URL; delete env.PGLITE_DIR; delete env.DEMO;
const server = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.on('data', (d) => String(d).includes('IdleWheels on') && ok()));

async function call(path, { token, method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  // --- accounts
  const dad = await ok('/auth/signup', { method: 'POST', body: { name: 'Dad', phone: '98765 43210', password: 'activa123' } });
  assert.equal(dad.user.phone, '+919876543210');
  assert.ok(dad.token.length > 30);
  assert.equal((await call('/auth/signup', { method: 'POST', body: { name: 'Dad2', phone: '+91 98765 43210', password: 'whatever1' } })).status, 409, 'one account per number');
  assert.equal((await call('/auth/signup', { method: 'POST', body: { name: 'X', phone: '98765 00000', password: '123' } })).status, 400, 'short password');
  assert.equal((await call('/auth/login', { method: 'POST', body: { phone: '9876543210', password: 'wrong-one' } })).status, 401);
  const dadPhone = await ok('/auth/login', { method: 'POST', body: { phone: '+919876543210', password: 'activa123' } });
  assert.equal((await ok('/me', { token: dadPhone.token })).name, 'Dad', 'second device logs in to the same account');
  await ok('/auth/logout', { token: dadPhone.token, method: 'POST' });
  assert.equal((await call('/me', { token: dadPhone.token })).status, 401, 'logout ends that session');
  assert.equal((await ok('/me', { token: dad.token })).name, 'Dad', 'other sessions stay logged in');
  const riya = await ok('/auth/signup', { method: 'POST', body: { name: 'Riya', phone: '91234 56789', password: 'scooter9' } });

  // --- demo listings are there from the start, with photos
  let listings = await ok('/listings');
  const demo = listings.filter((l) => l.demo);
  assert.equal(demo.length, 5);
  assert.ok(demo.every((l) => l.photo_url.startsWith('demo/listings/')));
  assert.ok(listings.every((l) => !('phone' in l)), 'listings must not leak phone numbers');

  // --- a real listing with an uploaded photo
  const { id: listingId } = await ok('/listings', { token: dad.token, method: 'POST', body: { vehicle: 'Honda Activa 6G', type: 'Scooter', area: 'Bachupally', from: '09:30', to: '17:30', price: 35, photo: PIXEL } });
  listings = await ok('/listings');
  const mine = listings.find((l) => l.id === listingId);
  assert.equal(mine.photo_url, `/api/listings/${listingId}/photo`);
  assert.ok(listings.indexOf(mine) < listings.findIndex((l) => l.demo), 'real listings come before demo ones');
  const photo = await call(mine.photo_url.replace('/api', ''));
  assert.equal(photo.status, 200);
  assert.equal(photo.data.byteLength, 70);
  assert.equal((await call('/listings', { token: dad.token, method: 'POST', body: { vehicle: 'X', type: 'Car', from: '09:00', to: '10:00', price: 50, photo: 'data:text/html;base64,PGgxPg==' } })).status, 400, 'only images');

  // --- request, accept, chat, report
  assert.equal((await call('/bookings', { token: dad.token, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '10:00', to: '14:00' } })).status, 400, 'owner cannot book own vehicle');
  assert.equal((await call('/bookings', { token: riya.token, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '08:00', to: '12:00' } })).status, 400, 'outside the free window');
  const { id: bookingId } = await ok('/bookings', { token: riya.token, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '10:00', to: '14:30', note: 'For college' } });
  const [asOwner] = await ok('/bookings', { token: dad.token });
  assert.equal(asOwner.role, 'owner');
  assert.equal(asOwner.status, 'pending');
  assert.equal(asOwner.cost, 158, '4.5 h × ₹35, rounded');
  assert.equal(asOwner.other.name, 'Riya');
  assert.ok(!asOwner.other.phone, 'phone hidden before accept');
  assert.equal((await call(`/bookings/${bookingId}/status`, { token: riya.token, method: 'POST', body: { status: 'accepted' } })).status, 400, 'renter cannot accept');
  const accepted = await ok(`/bookings/${bookingId}/status`, { token: dad.token, method: 'POST', body: { status: 'accepted' } });
  assert.equal(accepted.other.phone, '+919123456789');
  assert.equal((await call('/bookings', { token: riya.token, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '13:00', to: '15:00' } })).status, 409, 'overlap with accepted booking');
  const eve = await ok('/auth/signup', { method: 'POST', body: { name: 'Eve', phone: '9000000000', password: 'snooping' } });
  assert.equal((await call(`/bookings/${bookingId}/messages`, { token: eve.token })).status, 404, 'strangers cannot read the chat');
  await ok(`/bookings/${bookingId}/messages`, { token: dad.token, method: 'POST', body: { body: 'Pick up at the gate at 10?' } });
  await ok(`/bookings/${bookingId}/report`, { token: riya.token, method: 'POST', body: { verdict: 'ok', title: 'No new damage', model: 'gemma3:4b', angles: [{ angle: 'Front', verdict: 'no_new_damage', damage: [] }] } });
  const msgs = await ok(`/bookings/${bookingId}/messages`, { token: riya.token });
  assert.deepEqual(msgs.map((m) => m.kind), ['system', 'text', 'system', 'text', 'report']);
  assert.equal((await ok(`/bookings/${bookingId}/messages?after=${msgs[2].id}`, { token: riya.token })).length, 2);

  // --- demo owners accept straight away, never share a phone, and reply once
  const priya = demo.find((l) => l.owner === 'Priya');
  const { id: demoBooking } = await ok('/bookings', { token: riya.token, method: 'POST', body: { listing_id: priya.id, day: '2026-10-22', from: '10:00', to: '12:00' } });
  const db = await ok(`/bookings/${demoBooking}`, { token: riya.token });
  assert.equal(db.status, 'accepted');
  assert.equal(db.other.demo, true);
  assert.ok(!db.other.phone);
  await ok('/bookings', { token: eve.token, method: 'POST', body: { listing_id: priya.id, day: '2026-10-22', from: '10:00', to: '12:00' } });
  await ok(`/bookings/${demoBooking}/messages`, { token: riya.token, method: 'POST', body: { body: 'Thanks!' } });
  await ok(`/bookings/${demoBooking}/messages`, { token: riya.token, method: 'POST', body: { body: 'See you' } });
  const demoMsgs = await ok(`/bookings/${demoBooking}/messages`, { token: riya.token });
  assert.equal(demoMsgs.filter((m) => m.sender_id === priya.owner_id).length, 2, 'welcome + one reply');
  assert.equal((await call('/auth/login', { method: 'POST', body: { phone: 'demo-1', password: 'x' } })).status, 400, 'demo accounts cannot log in');

  await ok(`/listings/${listingId}`, { token: dad.token, method: 'DELETE' });
  assert.ok(!(await ok('/listings')).some((l) => l.id === listingId));

  // --- wrong-password throttle
  for (let i = 0; i < 8; i++) await call('/auth/login', { method: 'POST', body: { phone: '9123456789', password: 'nope' } });
  assert.equal((await call('/auth/login', { method: 'POST', body: { phone: '9123456789', password: 'scooter9' } })).status, 429);

  // --- static demo images are served, nothing else is
  assert.equal((await fetch(`${BASE}/demo/check/after-right.jpg`)).status, 200);
  assert.equal((await fetch(`${BASE}/server.js`)).status, 404);
  console.log('server flow: all checks passed');
} finally {
  server.kill();
}
