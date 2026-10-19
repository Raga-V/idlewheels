// End-to-end check of the server: owner lists, renter requests, owner accepts, they chat, a report is attached.
// Runs against a throwaway in-memory database: `npm test`.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}/api`;
const env = { ...process.env, PORT: String(PORT) };
delete env.DATABASE_URL; delete env.PGLITE_DIR;
const server = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.on('data', (d) => String(d).includes('IdleWheels on') && ok()));

async function call(path, { key, method = 'GET', body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(key ? { 'x-user-key': key } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
const ok = async (...a) => { const r = await call(...a); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };

try {
  const dad = await ok('/users', { method: 'POST', body: { name: 'Dad', phone: '98765 43210' } });
  const riya = await ok('/users', { method: 'POST', body: { name: 'Riya', phone: '+91 91234 56789' } });
  assert.equal((await call('/users', { method: 'POST', body: { name: 'X', phone: '12' } })).status, 400);

  const { id: listingId } = await ok('/listings', { key: dad.key, method: 'POST', body: { vehicle: 'Honda Activa 6G', type: 'Scooter', area: 'Bachupally', from: '09:30', to: '17:30', price: 35 } });
  const listings = await ok('/listings');
  assert.equal(listings.length, 1);
  assert.equal(listings[0].owner, 'Dad');
  assert.ok(!('phone' in listings[0]), 'listings must not leak phone numbers');

  assert.equal((await call('/bookings', { key: dad.key, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '10:00', to: '14:00' } })).status, 400, 'owner cannot book own vehicle');
  assert.equal((await call('/bookings', { key: riya.key, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '08:00', to: '12:00' } })).status, 400, 'outside the free window');

  const { id: bookingId } = await ok('/bookings', { key: riya.key, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '10:00', to: '14:00', note: 'For college' } });
  let [asOwner] = await ok('/bookings', { key: dad.key });
  assert.equal(asOwner.role, 'owner');
  assert.equal(asOwner.status, 'pending');
  assert.equal(asOwner.cost, 140);
  assert.equal(asOwner.other.name, 'Riya');
  assert.ok(!asOwner.other.phone, 'phone hidden before accept');

  assert.equal((await call(`/bookings/${bookingId}/status`, { key: riya.key, method: 'POST', body: { status: 'accepted' } })).status, 400, 'renter cannot accept');
  const accepted = await ok(`/bookings/${bookingId}/status`, { key: dad.key, method: 'POST', body: { status: 'accepted' } });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.other.phone, '+919123456789');

  assert.equal((await call('/bookings', { key: riya.key, method: 'POST', body: { listing_id: listingId, day: '2026-10-21', from: '13:00', to: '15:00' } })).status, 409, 'overlap with accepted booking');

  const stranger = await ok('/users', { method: 'POST', body: { name: 'Eve', phone: '9000000000' } });
  assert.equal((await call(`/bookings/${bookingId}/messages`, { key: stranger.key })).status, 404, 'strangers cannot read the chat');

  await ok(`/bookings/${bookingId}/messages`, { key: dad.key, method: 'POST', body: { body: 'Pick up at the gate at 10?' } });
  await ok(`/bookings/${bookingId}/report`, { key: riya.key, method: 'POST', body: { verdict: 'ok', title: 'No new damage', model: 'gemma3:4b', angles: [{ angle: 'Front', verdict: 'no_new_damage', damage: [] }] } });
  const msgs = await ok(`/bookings/${bookingId}/messages`, { key: riya.key });
  assert.deepEqual(msgs.map((m) => m.kind), ['system', 'text', 'system', 'text', 'report']);
  const later = await ok(`/bookings/${bookingId}/messages?after=${msgs[2].id}`, { key: riya.key });
  assert.equal(later.length, 2);

  await ok(`/listings/${listingId}`, { key: dad.key, method: 'DELETE' });
  assert.equal((await ok('/listings')).length, 0);
  console.log('server flow: all checks passed');
} finally {
  server.kill();
}
