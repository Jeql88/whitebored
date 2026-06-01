# Collaborative Whiteboard

A real-time, multi-user collaborative whiteboard. Draw together on an infinite
canvas with live cursors, presence, comments, and chat — changes sync across
clients in real time and persist between sessions.

**[Live demo](https://whiteboard-app.onrender.com)** — hosted free on Render.
The server sleeps after inactivity, so the first load may take ~30–60s to wake.
Open it in two tabs to see real-time sync.

## Stack

- **Frontend:** React 19 + Vite, [Excalidraw](https://github.com/excalidraw/excalidraw)
  canvas, Tailwind CSS (light/dark), `lucide-react` icons.
- **Backend:** Node.js + Express 5 + Socket.IO (WebSocket sync), MongoDB
  (native driver). A single Node process serves the API, the WebSocket
  endpoint, and the built React app.
- **Auth:** JWT + bcrypt, with guest access via shared links.

## Architecture

One service (`server/`) exposes:

- `GET /healthz` — liveness probe
- `POST /api/auth/{register,login}`
- `GET|POST|PATCH|DELETE /api/whiteboards` (+ `/:id/comments`)
- `/socket.io` — real-time scene + cursor + presence + chat
- everything else → the static React build (`client/dist`)

Drawing sync uses a **full-scene broadcast** model: on change, a client emits
its whole Excalidraw scene; the server persists one snapshot per board
(`scenes` collection) and rebroadcasts to the room.

## Local development

```bash
npm install                 # installs both workspaces (client + server)

# Terminal 1 — API + sockets (reads server/.env)
cp .env.example server/.env # then fill in MONGO_URI + JWT_SECRET
npm run dev:server

# Terminal 2 — Vite dev server (proxies /api and /socket.io to :4000)
npm run dev:client
```

Open http://localhost:5173.

## Production build

```bash
npm run build               # builds client/dist
npm start                   # server serves the build on $PORT
```

## Environment variables

| Var             | Required | Notes                                            |
| --------------- | -------- | ------------------------------------------------ |
| `MONGO_URI`     | yes      | MongoDB Atlas connection string                  |
| `JWT_SECRET`    | yes      | Random secret for signing tokens                 |
| `CLIENT_ORIGIN` | no       | CORS origin in dev; unset = same-origin in prod  |
| `PORT`          | no       | Injected by the host (Render); defaults to 4000  |

Secrets are never committed — set them in `server/.env` locally and in the host
dashboard in production.
