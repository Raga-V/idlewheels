# 🛵 IdleWheels

**Your bike is idle 9 hours a day. Rent it to someone who isn't, and let a local AI settle "that scratch was already there."**

College students and IT folks in India park their scooters, bikes and cars at 9 and don't touch them until 6. IdleWheels lets owners list those idle hours. The hard part of peer-to-peer rental isn't booking, it's trust, so the core of IdleWheels is an **AI handover check**:

1. At handover, the owner takes 4 photos (front, left, right, rear).
2. At return, the renter takes the same 4.
3. **Gemma 3** (open-weight, running on the owner's own laptop through Ollama) compares each pair and lists only the *new* damage, with a verdict and confidence.
4. Both people save the report as a PDF. That's the whole dispute process.

Live app: https://raga-v.github.io/idlewheels/ (the AI part needs Ollama on your laptop, see below)

## Run the AI locally

```bash
ollama pull gemma3:4b
# Windows:  setx OLLAMA_ORIGINS "*"   then restart Ollama from the tray
# Mac/Linux: OLLAMA_ORIGINS="*" ollama serve
```

Open the live app on the same laptop. Chrome may ask to let the site access devices on your local network: click **Allow**. (Or run it fully offline: `python -m http.server 8000` in this folder and open http://localhost:8000.) The pill at the top turns green when Gemma is reachable. Photos go only from your browser to `localhost`.

## How it works

- Plain HTML/CSS/JS, no build step, no backend. Listings are stored in your browser.
- Photos are downscaled to 768 px in the browser, then sent with both images in one request to Ollama's `/api/chat`, with a JSON schema.
- The schema makes the model **describe each photo first**, then decide what changed. Ollama fills fields in schema order, so the verdict is grounded in what it just described. It is also told to ignore lighting, angle and reflections, and to answer "unsure" rather than invent damage.
- GitHub Actions syntax-checks the app and deploys it to GitHub Pages on every push (`.github/workflows/deploy.yml`).

## Why open models

Vehicle photos contain number plates, homes and faces. With an open-weight model on the owner's laptop, they never touch a third-party server, every check costs ₹0, and you can swap in `gemma3:12b` for sharper eyes.

## Honest limits

- A 4B vision model misses tiny scratches and can be fooled by glare. Treat the report as a second pair of eyes, not a judge.
- Renting out a private (white-plate) vehicle for money needs commercial registration and insurance in India. This is a demo of the trust layer, not a legal rental service.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 2: Side Hustle. Idea by my dad.

MIT License.
