# Trade Journal (Static SPA)

Simple single-page Trade Journal using HTML/CSS/JS and `localStorage` for data persistence. No user accounts required. Exports to CSV and PDF.

Quick start

1. Open `index.html` in a browser (or serve the folder statically).

2. Add trades using the `+ Add Trade` button. Data is stored in your browser's `localStorage`.

3. Export CSV or PDF using the header buttons.

Deploy to Vercel

- Create a new project on Vercel and point it to this repository or folder. Vercel will serve the static `index.html`.

Server (optional)

- A simple Node/Express server with SQLite is included under `server/`. It provides CRUD API endpoints at `/api/trades` and uses `better-sqlite3`.

To run the server locally:

```bash
cd server
npm install
npm run dev
```

Then open `index.html` in a browser or serve the static folder; the SPA will attempt to use the server API if reachable.

Run combined (serve SPA from server):

```bash
# from project root
cd server
npm install
node server.js

# then open http://localhost:3001/ in your browser
```

Deploy static SPA to Vercel

1. Create a new Git repo and push the project root.

```bash
git init
git add .
git commit -m "Initial trade-journal SPA"
git remote add origin <your-repo-url>
git push -u origin main
```

2. On Vercel, import the repository and deploy. The `.vercelignore` will exclude the `server/` folder so Vercel will serve the static `index.html`.

Deploy server (optional)

- For the Node/SQLite server, deploy to a host that supports persistent files (Render, Railway). Vercel serverless is not recommended for SQLite.

