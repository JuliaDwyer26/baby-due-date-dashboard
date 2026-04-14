# Baby Due Date Betting Dashboard

Public dashboard for the family betting pool:
- Leaderboard (closest guess wins)
- Timeline of all guesses
- Pot summary using fixed $10 entry
- Odds-style distribution by guessed date
- Countdown + winner state
- Intro overlay animation with giant die-cut baby face
- Carnival race board with live knockout + grayscale elimination
- Due-date confetti celebration
- Dramatic browser audio for eliminations

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Data Updates

### Update the bets list
1. Open `data/bets.csv`.
2. Replace rows with the latest sheet snapshot.
3. Keep columns exactly as:
   - `Timestamp`
   - `Name`
   - `Date Guess`
   - `Time Guess`
   - `Payment Sent?` (`Yes` or `No`)

### Update due date and winner logic
Edit `lib/config.ts`:
- `dueDateIso`: canonical due date/time
- `actualBirthIso`: leave empty until baby arrives

When baby arrives, set `actualBirthIso` to an ISO timestamp (example: `2026-04-19T09:14:00-07:00`).  
The leaderboard will automatically switch from projected closest-to-due-date to actual closest-to-birth.

## Image Uploads (faces + intro)

The app auto-loads face images from `public/faces/` using each participant's slug:

- `Tanner Larson` -> `public/faces/tanner-larson.png`
- `Pepe Le Pew (Uncle Rex)` -> `public/faces/pepe-le-pew-uncle-rex.png`
- `Kalina's Future Dog` -> `public/faces/kalina-s-future-dog.png`

The intro overlay image should be:
- `public/faces/baby-intro.png`

If any image is missing, the app falls back to:
- `public/faces/placeholder-face.svg`

Recommended image format: square PNG (at least 512x512).

## Deploy

```bash
npm run build
```

Deploy to Vercel from GitHub integration or Vercel CLI.
