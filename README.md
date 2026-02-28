# Wordle Maker

A custom Wordle puzzle creator and player. Choose any secret word, set the number of allowed guesses, and add an optional title or hint — then share the puzzle as a single URL. The word is **never** visible in the link; it is encrypted client-side with AES-GCM before being embedded in the URL.

## Features

- **Custom word length** — any word from 3 to 25 letters
- **Client-side encryption** — the secret word is AES-GCM encrypted; the URL contains only ciphertext
- **Configurable guesses** — set 1–12 allowed guesses per puzzle
- **Title & hint** — optionally attach a title or hint that players see before guessing
- **Share results** — copy a spoiler-free emoji grid to share your solve
- **Dark / light theme** — toggle persisted across visits
- **On-screen keyboard** — colour-coded key states (correct / present / absent)

## Tech Stack

- [React 19](https://react.dev/) with [Vite](https://vite.dev/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) — AES-GCM encryption, no server required
- [Vercel](https://vercel.com/) — hosting and analytics

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install & run

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for production

```bash
npm run build
npm run preview   # preview the production build locally
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VITE_APP_AES_KEY` | Base64-encoded 32-byte AES key used to encrypt puzzle URLs | A built-in dev key (replace in production) |

Create a `.env.local` file in the project root to override the default key:

```env
VITE_APP_AES_KEY=<your-base64-encoded-32-byte-key>
```

> **Note:** The default key is public and intended for local development only. Generate a unique key for any publicly deployed instance.

## Usage

1. **Create a puzzle** — click **Make your own puzzle**, enter a secret word, adjust the settings, then click **Generate link**.
2. **Share the link** — copy the generated URL and send it to whoever you want to challenge.
3. **Play** — open the link in a browser. The board and keyboard appear automatically. Type guesses with the keyboard or use the on-screen keys.
4. **Share your result** — after winning, click **Share result** to copy an emoji grid to your clipboard.

## Linting

```bash
npm run lint
```
