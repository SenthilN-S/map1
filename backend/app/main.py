from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .crowd import GridConfig, cell_to_center_latlon, density_per_m2, latlon_to_cell, level_for_count, now_ms
from .models import CrowdConfig, CrowdConfigUpdate, CrowdSnapshot, IncidentReport, LocationPing, ZoneCell
from .store import InMemoryStore

cfg = GridConfig()
store = InMemoryStore(cfg)

app = FastAPI(title="Crowd Monitor API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Hub:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sockets: set[WebSocket] = set()

    async def add(self, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets.add(ws)

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets.discard(ws)

    async def broadcast(self, msg: dict[str, Any]) -> None:
        payload = json.dumps(msg, separators=(",", ":"))
        async with self._lock:
            sockets = list(self._sockets)
        if not sockets:
            return
        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._sockets.discard(ws)


hub = Hub()


def build_snapshot(devices: dict, incidents: list[dict]) -> CrowdSnapshot:
    # Aggregate into 10m grid cells
    per_cell: dict[tuple[int, int], set[str]] = {}
    lat_hint = 0.0
    for device_id, st in devices.items():
        lat_hint = st.lat
        cell = latlon_to_cell(st.lat, st.lon, cfg.cell_size_m)
        per_cell.setdefault(cell, set()).add(device_id)

    zones: list[ZoneCell] = []
    for (cx, cy), ids in per_cell.items():
        count = len(ids)
        center_lat, center_lon = cell_to_center_latlon(cx, cy, lat_hint=lat_hint, cell_size_m=cfg.cell_size_m)
        dens = density_per_m2(count, cfg.cell_size_m)
        zones.append(
            ZoneCell(
                cellX=cx,
                cellY=cy,
                centerLat=center_lat,
                centerLon=center_lon,
                count=count,
                densityPerM2=dens,
                level=level_for_count(count, cfg),
            )
        )

    return CrowdSnapshot(
        nowTs=now_ms(),
        cellSizeM=cfg.cell_size_m,
        zones=zones,
        incidents=[IncidentReport(**i) for i in incidents],
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    devices, _ = await store.snapshot()
    return {"ok": True, "activeDevices": len(devices), "cellSizeM": cfg.cell_size_m}


@app.get("/config")
async def get_config() -> CrowdConfig:
    return CrowdConfig(
        cellSizeM=cfg.cell_size_m,
        deviceTtlS=cfg.device_ttl_s,
        yellowMinCount=cfg.yellow_min_count,
        redMinCount=cfg.red_min_count,
    )


@app.post("/config")
async def update_config(update: CrowdConfigUpdate) -> CrowdConfig:
    def bad(msg: str) -> None:
        raise HTTPException(status_code=400, detail=msg)

    if update.cellSizeM is not None:
        if update.cellSizeM < 5 or update.cellSizeM > 200:
            bad("cellSizeM must be between 5 and 200")
        cfg.cell_size_m = int(update.cellSizeM)
    if update.deviceTtlS is not None:
        if update.deviceTtlS < 5 or update.deviceTtlS > 300:
            bad("deviceTtlS must be between 5 and 300")
        cfg.device_ttl_s = int(update.deviceTtlS)
    if update.yellowMinCount is not None:
        if update.yellowMinCount < 1 or update.yellowMinCount > 500:
            bad("yellowMinCount must be between 1 and 500")
        cfg.yellow_min_count = int(update.yellowMinCount)
    if update.redMinCount is not None:
        if update.redMinCount < 1 or update.redMinCount > 500:
            bad("redMinCount must be between 1 and 500")
        cfg.red_min_count = int(update.redMinCount)

    if cfg.red_min_count < cfg.yellow_min_count:
        cfg.red_min_count = cfg.yellow_min_count

    return await get_config()


@app.post("/report")
async def report(incident: IncidentReport) -> dict[str, Any]:
    await store.add_incident(incident.model_dump())
    return {"ok": True}


@app.websocket("/ws")
async def ws(ws: WebSocket) -> None:
    await ws.accept()
    await hub.add(ws)
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                ping = LocationPing(**data)
            except Exception:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid_payload"}))
                continue
            await store.upsert_device(ping.deviceId, ping.lat, ping.lon, ping.ts)
            await ws.send_text(json.dumps({"type": "ack", "ts": ping.ts}))
    except WebSocketDisconnect:
        pass
    finally:
        await hub.remove(ws)


async def broadcaster_loop() -> None:
    while True:
        await asyncio.sleep(1.0)
        await store.prune()
        devices, incidents = await store.snapshot()
        snap = build_snapshot(devices, incidents)
        await hub.broadcast({"type": "snapshot", "data": snap.model_dump()})


@app.on_event("startup")
async def _startup() -> None:
    asyncio.create_task(broadcaster_loop())

