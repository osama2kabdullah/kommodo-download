# Kommodo Video Downloader 🐊

A high-fidelity, full-stack video stream extractor and media downloader engineered for flawless performance. Designed with a clean, responsive layout, this utility retrieves video clips and sequential stream segments dynamically without external third-party API keys or paid tokens.

---

## 🚀 Introduction

**Kommodo Video Downloader** is a robust single-view streaming media utility. It maps, extracts, and assembles video contents directly from page links or raw video URLs. 

The application is built on top of:
- **Frontend**: React, Vite, and Tailwind CSS. Featuring the **Emerald Mascot design theme**, sleek components, and linear status indicators.
- **Backend Routing**: Optimally suited for both standalone Node environments and Serverless standard edge engines.

---

## 🏛️ Architecture: Do I Still Need ExpressJS?

**Yes.** Here is how **ExpressJS** (`server.ts`) and **Vercel Serverless Functions** (`/api/*`) work together in harmony, and why both are preserved in this template:

### 1. Standalone Independent Hosting & Local Development (`ExpressJS` via `server.ts`)
- **Local Dev Server**: Inside your local machine, running `npm run dev` boots up the Express backend, which dynamically attaches Vite's dev middleware. This lets you serve the frontend and route `/api/*` endpoints perfectly using a single execution context on Port 3000.
- **Docker & Container Runs**: If you decide to package your app to Google Cloud Run, Heroku, or standard Linux VPS containers, they require a persistent running Node process. Express plays this central role, serving production static bundles and proxying data requests securely.

### 2. Cloud Serverless Deployments (`Vercel` via `/api/*.ts`)
- When deploying to **Vercel**, Vercel's edge-router ignores `server.ts` entirely.
- Instead, Vercel inspects `vercel.json` and routes `/api/*` requests directly to individual Serverless Function files located in the `/api/` directory (`api/analyze.ts` and `api/download-proxy.ts`).
- **Benefit**: This architecture provides **perfect modularity**—allowing local full-system independence while maintaining native compatibility with serverless, high-scalability platforms.

---

## 💎 Core Capabilities & Mechanics

1. **Local High-Fidelity DOM Mapping**:
   - Integrates server-side metadata scanners that identify video components, layouts, script segments, and hidden streaming endpoints directly, using lightweight extraction pipelines that eliminate translation delay.
2. **Dynamic Assembly (HLS/M3U8 playlists directly to MP4)**:
   - When encountering stream segment indexes (`.m3u8`), the downloader requests variant streams, downstreams segment fragments sequentially, and packages them in real-time as a single, fully play-ready, double-clickable `.mp4` file sent straight to the user's browser, preventing cross-site blocking (CORS restrictions).
3. **0 MB Persistent Storage Footprint**:
   - Media datasets are piped dynamically to the output download stream buffer in real-time. No segments are stored locally, resulting in **zero disk space allocation** and ensuring compliance with sandbox policies.
4. **Enhanced Progress Tracking**:
   - Modern linear state trackers display the calculated transmission updates strictly as real-time **Megabytes (MB)** downloaded, eliminating distracting estimation sizes or false percent triggers.

---

## 🛠️ Contribution Guidelines

We highly encourage contributions to the Kommodo project! To keep the code clean, professional, and consistent, please follow these principles:

### Repository file map:
* `/src` — Frontend React UI codebase (styled via Tailwind CSS, animated via `motion`).
* `/api` — Serverless handler functions used on deployment providers like Vercel.
* `server.ts` — Standalone Express server used for local developer sessions and native container setups.
* `vercel.json` — Gateway routing configs mapping API endpoints to the serverless pipeline.

### Rules for Contributing:
- **Strict Scope Focus**: All interface layouts must focus strictly on delivering video extraction metrics safely. Avoid adding redundant side navigation, user logins, or heavy analytics.
- **Tailwind-First Styling**: Keep inline CSS styles out of components. Use utility classes and keep color themes within the refined **Deep Charcoal Slate** and **Emerald Accent** families.
- **Type Safety**: Provide explicit TypeScript interface descriptions and strictly avoid `any` declarations in client-side files where possible.

---

## 📦 Local Development Setup

To setup your workspace to write or audit code locally, execute the following instructions in terminal:

```bash
# 1. Populate workspace dependencies
npm install

# 2. Boot dev environment (starts Express + mounts Vite middleware)
npm run dev
```
Open your browser to `http://localhost:3000` to interact with your live application workspace.

To bundle production assets and run testing:
```bash
# 1. Compile both React client and Node wrapper files 
npm run build

# 2. Spin up the static server representation
npm run start
```

---

## ☁️ Vercel Deployment Guide (100% Free)

Deploying Kommodo Video Downloader on Vercel is streamlined and completely free:

1. Push your active codebase repository to your **GitHub** account.
2. Visit the [Vercel Console](https://vercel.com) and click **"Add New Project"**.
3. Authorize and import your newly created repository.
4. Keep the default configuration options unchanged (Vercel automatically detects the Vite structure and maps build folders to `dist/`).
5. Set environment variables to empty.
6. Press the **"Deploy"** button. 

Within minutes, your high-fidelity, high-speed streaming platform will be online with global HTTPS routing, zero paywalls, and automatic serverless scalability!
