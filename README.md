# Clipper

AI-powered video clipper that turns long videos into viral short clips (9:16). Runs entirely in your browser.

**Stack:** Next.js (Vercel) + Groq Whisper API + ffmpeg.wasm

## Features

- Upload video/audio file (max 25MB — Groq Whisper limit)
- Transcribe with Groq Whisper Large v3 Turbo (fast, generous free tier)
- Auto-suggest viral clip segments with Groq LLM (Llama 3.3 70B)
- Cut clips and reformat to 9:16 vertical with blurred background
- Burn-in word-level captions from Whisper timestamps
- All processing happens client-side (ffmpeg.wasm) — no server compute

## Setup

### 1. Get a free Groq API key
- Go to https://console.groq.com
- Create an account → API Keys → Create key
- Free tier: 2,000 requests/day, ~2 hours audio/hour

### 2. Install & run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000

Enter your Groq API key in the UI (stored in localStorage), or set it as an env var:
```bash
cp .env.example .env.local
# Edit .env.local and add your GROQ_API_KEY
```

### 3. Deploy to Vercel
```bash
npm i -g vercel
vercel
```
Or import the repo on https://vercel.com → New Project.

Set `GROQ_API_KEY` in Vercel → Settings → Environment Variables (optional — users can enter their own key in the UI).

## How it works

1. User uploads video/audio → sent to `/api/transcribe` → Groq Whisper API
2. Transcript with word-level timestamps returned
3. User selects segment (or clicks AI suggestion)
4. `ffmpeg.wasm` runs in browser: cuts segment, reformats to 9:16 with blur background, burns captions
5. Download the finished clip as MP4

## Limitations

- Max 25MB input file (Groq Whisper API limit)
- ffmpeg.wasm is slower than native ffmpeg (expect 10-60s for a 30s clip depending on resolution)
- No YouTube URL support (yt-dlp can't run on Vercel serverless)
- COOP/COEP headers are set globally for ffmpeg.wasm compatibility

## Cost

- Vercel: free tier sufficient
- Groq: free tier sufficient for personal use
- Total: $0
