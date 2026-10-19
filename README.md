# IdleWheels

**Your scooter naps 9 hours a day. Let it earn.**

College students and office-goers in India park their scooters, bikes and cars at 9 and don't touch them until 6. IdleWheels lets neighbours rent each other's vehicles for exactly those idle hours. Booking is the easy part. The hard part of peer-to-peer rental is trust, so the core of IdleWheels is an **AI handover check** that runs on an open model on the owner's own laptop.

Live: https://idlewheels.onrender.com (also https://raga-v.github.io/idlewheels/)

## How it works

1. **List the idle hours.** The owner says when the vehicle is free. Gemma sorts the vehicle into a price class (a Splendor is budget, a Royal Enfield is premium) and the app suggests a fair hourly price from real Hyderabad rental rates.
2. **Request and chat.** A neighbour picks a day and hours and sees the total cost. The owner accepts or declines. Once accepted, both get each other's phone number (call or WhatsApp) and a chat inside the booking to plan the pickup.
3. **Snap 4 photos at pickup** (front, left, right, rear), and the same 4 at return.
4. **Gemma 3 compares each pair** and lists only the *new* damage, with a verdict and confidence. The report is posted into the booking chat, and both people can save it as a PDF. That's the whole dispute process.

## Try it without a vehicle

- **Demo listings** (an Activa, a Jupiter, a Royal Enfield, a Pulsar and a Swift, with real photos) are there from the start. Their owners accept requests automatically and reply in the chat, so you can walk through request → chat → handover check on your own.
- In the handover check, **Use sample photos** loads 4 pickup and 4 return photos of a Honda Activa. One side came back with tape and a scratch. The report shows the answer key next to Gemma's verdict.

## Accounts and privacy

- **Sign up with your phone number and a password**, then log in on any device. Passwords are stored as salted scrypt hashes, sessions are random tokens (only their SHA-256 hash is stored), and repeated wrong passwords are throttled. There is no SMS OTP, so phone numbers aren't verified.
- **Handover photos never leave the device.** They're downscaled in the browser and sent only to Ollama on the owner's laptop (`localhost`). The server only sees the text verdict. Listing photos are public by design.
- **Phone numbers stay hidden** until the owner accepts a booking.

## Run the AI locally

```bash
ollama pull gemma3:4b
# Windows:  setx OLLAMA_ORIGINS "https://idlewheels.onrender.com,https://raga-v.github.io"   then restart Ollama from the tray
# Mac/Linux: OLLAMA_ORIGINS="https://idlewheels.onrender.com,https://raga-v.github.io" ollama serve
```

Open the app on the same laptop. If Chrome asks to let the site access devices on your local network, click **Allow**. The pill at the top turns green when Gemma is reachable.

## Run the whole app locally

```bash
npm install
npm start          # http://localhost:8000, with an in-memory Postgres (PGlite), so no database setup
npm test           # end-to-end server test: list, request, accept, chat, report
```

Set `DATABASE_URL` to use a real Postgres.

## How it's built

- **Frontend:** plain HTML/CSS/JS with no build step. Tyro, the tyre mascot, and all the icons are inline SVG.
- **Server:** `server.js`, a dependency-light Node server (only `pg`) that serves the app and a small JSON API for accounts, listings, bookings, messages and reports. It runs on Render with Render Postgres (`render.yaml`). Set `DEMO=off` to skip the demo listings.
- **Damage check:** both photos go in one request to Ollama's `/api/chat` with a JSON schema. The schema makes the model **describe each photo first**, then decide what changed. Ollama fills fields in schema order, so the verdict is grounded in what it just described. It is told to ignore lighting, angle and reflections, and to answer "unsure" rather than invent damage.
- **Price tip:** a 4B model asked for rupee amounts swung between ₹95, ₹180 and ₹600/hr for similar vehicles. So Gemma only picks the class, and the rupees come from real local rates set a little below commercial rentals.
- **CI:** GitHub Actions syntax-checks the app, runs the server test, and deploys the static copy to GitHub Pages.

## Honest limits

- A 4B vision model misses tiny scratches and can be fooled by glare. Treat the report as a second pair of eyes, not a judge. Swap in `gemma3:12b` for sharper eyes.
- Phone numbers aren't verified (no SMS OTP).
- Demo photos come from Wikimedia Commons; see [CREDITS.md](CREDITS.md).
- Renting out a private (white-plate) vehicle for money needs commercial registration and insurance in India. This is a demo of the trust layer, not a legal rental service.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 2: Side Hustle. Idea by my dad.

MIT License.
