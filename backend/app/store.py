from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from .crowd import GridConfig


@dataclass
class DeviceState:
    lat: float
    lon: float
    ts_ms: int
    last_seen_ms: int


class InMemoryStore:
    def __init__(self, cfg: GridConfig):
        self.cfg = cfg
        self._lock = asyncio.Lock()
        self._devices: dict[str, DeviceState] = {}
        self._incidents: list[dict] = []

    async def upsert_device(self, device_id: str, lat: float, lon: float, ts_ms: int) -> None:
        now = int(time.time() * 1000)
        async with self._lock:
            self._devices[device_id] = DeviceState(lat=lat, lon=lon, ts_ms=ts_ms, last_seen_ms=now)

    async def add_incident(self, incident: dict) -> None:
        async with self._lock:
            self._incidents.append(incident)
            # Keep last 500 for MVP
            if len(self._incidents) > 500:
                self._incidents = self._incidents[-500:]

    async def snapshot(self) -> tuple[dict[str, DeviceState], list[dict]]:
        async with self._lock:
            return dict(self._devices), list(self._incidents)

    async def prune(self) -> int:
        now = int(time.time() * 1000)
        cutoff = now - (self.cfg.device_ttl_s * 1000)
        removed = 0
        async with self._lock:
            for k in list(self._devices.keys()):
                if self._devices[k].last_seen_ms < cutoff:
                    del self._devices[k]
                    removed += 1
        return removed

