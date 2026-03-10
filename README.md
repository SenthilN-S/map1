# Real-time Crowd Monitoring & Accessible Map (MVP)

This project is a working MVP of a **real-time crowd monitoring system** that:

- Collects **anonymous GPS pings** from users (PWA).
- Computes **crowd density** on the backend using **10m x 10m grid aggregation** (optionally DBSCAN-ready hooks).
- Streams **live heatmap + green/yellow/red zones** to clients in real time.
- Provides **alerts** (voice + vibration) when users approach **red zones**.
- Includes a simple **admin dashboard** for authorities to monitor live crowding and incidents.

## Folder structure

- `backend/` – FastAPI server (WebSocket + REST), in-memory store (MongoDB optional later)
- `frontend/` – Mobile-friendly PWA (Leaflet + OSM tiles), no build step (no npm required)

## Privacy model (implemented)

- No names / emails / phone numbers collected.
- A **temporary device ID** is generated locally in the browser and rotated periodically.
- Only `{deviceId, lat, lon, ts}` is sent.
- Supports running behind TLS (recommended) so traffic is encrypted in transit.

## Run the backend

Prereqs: Python 3.10+

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Run the frontend (PWA)

Because the frontend has **no build step**, you can serve it with any static server.

Option A (Python):

```bash
cd frontend
python -m http.server 5173
```

Then open:

- User app: `http://localhost:5173/`
- Admin dashboard: `http://localhost:5173/admin.html`

## Configure URLs

Frontend talks to backend at:

- `ws://localhost:8000/ws` (WebSocket live stream)
- `http://localhost:8000` (REST)

If you deploy, update `frontend/config.js`.

## Notes / next steps

- Add persistent storage (MongoDB/Firebase) for historical analytics.
- Add route-avoidance using a routing engine (OSRM/GraphHopper) with dynamic “avoid polygons”.
- Add differential privacy / geo-hashing if you need stronger privacy guarantees.

