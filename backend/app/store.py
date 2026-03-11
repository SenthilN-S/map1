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
        self._events: dict[str, dict] = {}
        self._sos_alerts: dict[str, dict] = {}

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

    async def clear_incidents(self) -> None:
        async with self._lock:
            self._incidents = []

    async def snapshot(self) -> tuple[dict[str, DeviceState], list[dict], list[dict], list[dict]]:
        async with self._lock:
            active_sos = [a for a in self._sos_alerts.values() if not a.get("resolved", False)]
            approved_events = [e for e in self._events.values() if e.get("status") == "approved"]
            return dict(self._devices), list(self._incidents), approved_events, active_sos

    async def add_event(self, event_dict: dict) -> None:
        async with self._lock:
            self._events[event_dict["eventId"]] = event_dict

    async def get_all_events(self) -> list[dict]:
        async with self._lock:
            return list(self._events.values())

    async def update_event_status(self, event_id: str, status: str) -> bool:
        async with self._lock:
            if event_id in self._events:
                self._events[event_id]["status"] = status
                return True
            return False

    async def add_sos(self, sos_dict: dict) -> None:
        async with self._lock:
            self._sos_alerts[sos_dict["sosId"]] = sos_dict

    async def resolve_sos(self, sos_id: str) -> bool:
        async with self._lock:
            if sos_id in self._sos_alerts:
                self._sos_alerts[sos_id]["resolved"] = True
                return True
            return False

    async def get_all_sos(self) -> list[dict]:
        async with self._lock:
            return list(self._sos_alerts.values())

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

