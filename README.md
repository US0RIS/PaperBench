# PaperBench

PaperBench is a local-first academic research and writing environment with a full macOS desktop app and a browser build.

The macOS app packages the existing PaperBench editor together with its Node backend. You do **not** need to start a separate server: the app launches a private loopback service on a random local port and shuts it down with the app.

## What is included

- Academic editor built on ProseMirror
- Local project database in IndexedDB
- Literature search across Crossref, OpenAlex, Semantic Scholar, PubMed, arXiv and other configured providers
- DOI / ISBN resolution
- Wikipedia and dictionary tools
- Arbitrary web-page capture and reader view
- Open-access PDF retrieval and PDF reader / highlighting
- Citations, CSL styles, bibliography generation, notes, evidence links and comments
- Suggested edits / track-changes workflow
- DOCX, HTML, Markdown, LaTeX, text and bibliography exports
- PDF printing through the macOS print system
- Source-grounded Anthropic assistance
- Native macOS Save dialogs for exports and backups
- Secure local API-key storage through Electron `safeStorage` (macOS Keychain-backed encryption)

The renderer has no Node.js access. Electron runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`. External links are opened in the system browser rather than navigated inside the privileged application window.

## Run the macOS app from source

Requirements:

- macOS
- Node.js 22 or newer
- npm

```bash
npm install
npm run desktop
```

That command builds the frontend, starts Electron, starts the embedded backend on `127.0.0.1` using an ephemeral port, and opens PaperBench.

### AI assistance

Open **Assist** in PaperBench, or use **PaperBench → AI Settings…** (`⌘,`). Enter an Anthropic API key and model. The key is encrypted with macOS secure storage and saved in the app's Application Support directory; it is not stored in IndexedDB or sent to the renderer.

To remove it, open **AI settings** in the Assist panel and choose **Remove key**.

## Build a distributable macOS app

```bash
npm install
npm run dist:mac
```

Artifacts are written to `release/` as a DMG and ZIP. `build/icon.svg` is converted by electron-builder into the macOS app icon.

For public distribution, sign and notarize the app with your Apple Developer credentials. electron-builder can use `CSC_LINK` / `CSC_NAME` for signing and the standard Apple notarization environment variables. Local unsigned builds still work for development, but Gatekeeper will warn on a machine that did not build the app.

## Browser / server mode

The web build remains available:

```bash
npm install
npm run build
npm start
```

Then open `http://127.0.0.1:5173`.

In browser mode, set `ANTHROPIC_API_KEY` and optionally `ANTHROPIC_MODEL` before starting the server if you want AI assistance.

```bash
ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-sonnet-5-5 npm start
```

You can also build the self-contained browser-only file:

```bash
npm run build:single
```

That produces `dist-single/paper.html`. Browser-only mode cannot provide the backend-only web capture, arXiv proxy, open-access PDF fetch, link checking, or protected AI-key handling.

## Backend security model

The embedded backend binds only to `127.0.0.1`; Electron chooses a random free port for each launch. The arbitrary-URL fetch endpoint:

- accepts only HTTP(S)
- rejects URLs containing credentials
- resolves each destination before requesting it
- rejects loopback, private, link-local, multicast and other non-public IP ranges
- revalidates redirects
- limits redirects and response size
- has request timeouts

The metadata proxy has a separate host allowlist. Request bodies are size-limited. The Anthropic API key never appears in `/api/status` or `/api/settings/ai` responses.

## Tests

Backend tests require only Node itself:

```bash
npm run test:backend
```

The existing workflow and visual tests under `tests/` exercise research, Wikipedia, PDF, revision, structure, resilience and export behavior. They use fixtures for external APIs and therefore do not prove live third-party API availability.

## Architecture

```text
macOS app
┌─────────────────────────────────────────────────────┐
│ Electron main process                               │
│  ├─ native window / menus / Save dialogs            │
│  ├─ encrypted desktop settings                      │
│  └─ embedded PaperBench HTTP backend (127.0.0.1)    │
│       ├─ scholarly proxy                            │
│       ├─ safe web/PDF fetch                         │
│       ├─ link checker                               │
│       └─ Anthropic Messages API                     │
└──────────────────────┬──────────────────────────────┘
                       │ loopback HTTP
┌──────────────────────▼──────────────────────────────┐
│ sandboxed renderer                                  │
│  ├─ ProseMirror editor                              │
│  ├─ research / reader / notebook / review UI        │
│  └─ IndexedDB projects and attached source blobs    │
└─────────────────────────────────────────────────────┘
```

Important files:

- `electron/main.mjs` — macOS application lifecycle, native integration, secure settings and backend startup
- `electron/preload.cjs` — minimal IPC bridge
- `server.js` — reusable backend plus standalone browser server
- `src/` — application frontend
- `build.mjs` — web asset bundling
- `build/icon.svg` — application icon source

## Data location

Paper projects remain local to the Electron Chromium profile. On macOS that profile lives under the normal PaperBench Application Support directory managed by Electron. Project backups can also be exported explicitly from PaperBench.

Deleting the app itself does not automatically delete its Application Support data.
