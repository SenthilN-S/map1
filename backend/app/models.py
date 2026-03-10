from __future__ import annotations

from pydantic import BaseModel, Field


class LocationPing(BaseModel):
    deviceId: str = Field(min_length=6, max_length=128)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    ts: int = Field(description="Client timestamp (ms since epoch)")


class IncidentReport(BaseModel):
    deviceId: str = Field(min_length=6, max_length=128)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    ts: int
    kind: str = Field(default="crowd_incident", max_length=64)
    message: str = Field(default="", max_length=500)


class ZoneCell(BaseModel):
    cellX: int
    cellY: int
    centerLat: float
    centerLon: float
    count: int
    densityPerM2: float
    level: str  # green | yellow | red


class CrowdSnapshot(BaseModel):
    nowTs: int
    cellSizeM: int
    zones: list[ZoneCell]
    incidents: list[IncidentReport]


class CrowdConfig(BaseModel):
    cellSizeM: int
    deviceTtlS: int
    yellowMinCount: int
    redMinCount: int


class CrowdConfigUpdate(BaseModel):
    cellSizeM: int | None = None
    deviceTtlS: int | None = None
    yellowMinCount: int | None = None
    redMinCount: int | None = None

