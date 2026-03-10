from __future__ import annotations

import math
import time
from dataclasses import dataclass


@dataclass
class GridConfig:
    cell_size_m: int = 10
    device_ttl_s: int = 30
    # Thresholds expressed as "devices per 10x10m cell"
    yellow_min_count: int = 3
    red_min_count: int = 6


def _meters_per_deg_lon(lat: float) -> float:
    return 111_320.0 * math.cos(math.radians(lat))


def latlon_to_cell(lat: float, lon: float, cell_size_m: int) -> tuple[int, int]:
    # Approx conversion degrees->meters; good enough for small cells.
    y_m = lat * 111_320.0
    x_m = lon * _meters_per_deg_lon(lat)
    return (math.floor(x_m / cell_size_m), math.floor(y_m / cell_size_m))


def cell_to_center_latlon(cell_x: int, cell_y: int, lat_hint: float, cell_size_m: int) -> tuple[float, float]:
    # Convert back using same local approximation (lon depends on latitude).
    center_y_m = (cell_y + 0.5) * cell_size_m
    center_lat = center_y_m / 111_320.0

    m_per_deg_lon = _meters_per_deg_lon(lat_hint if abs(lat_hint) <= 90 else center_lat)
    if m_per_deg_lon == 0:
        center_lon = 0.0
    else:
        center_x_m = (cell_x + 0.5) * cell_size_m
        center_lon = center_x_m / m_per_deg_lon

    return center_lat, center_lon


def level_for_count(count: int, cfg: GridConfig) -> str:
    if count >= cfg.red_min_count:
        return "red"
    if count >= cfg.yellow_min_count:
        return "yellow"
    return "green"


def density_per_m2(count: int, cell_size_m: int) -> float:
    area = float(cell_size_m * cell_size_m)
    return count / area if area > 0 else 0.0


def now_ms() -> int:
    return int(time.time() * 1000)

