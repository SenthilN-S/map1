/* global L */
(() => {
  const CFG = window.CROWD_CONFIG;
  const statusEl = document.getElementById("statusText");
  const riskEl = document.getElementById("riskText");

  const setStatus = (s) => (statusEl.textContent = s);
  const setRisk = (s) => (riskEl.textContent = s);

  const supportsVibrate = () => typeof navigator.vibrate === "function";
  const speak = (text) => {
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  };

  const randId = () => {
    const part = () => Math.random().toString(16).slice(2);
    return `tmp_${Date.now().toString(16)}_${part()}${part()}`.slice(0, 48);
  };

  const getDeviceId = () => {
    const now = Date.now();
    const raw = localStorage.getItem("device_id_state");
    if (!raw) {
      const state = { id: randId(), born: now };
      localStorage.setItem("device_id_state", JSON.stringify(state));
      return state.id;
    }
    try {
      const state = JSON.parse(raw);
      if (!state?.id || !state?.born) throw new Error("bad");
      if (now - state.born > CFG.DEVICE_ID_ROTATE_MS) {
        const next = { id: randId(), born: now };
        localStorage.setItem("device_id_state", JSON.stringify(next));
        return next.id;
      }
      return state.id;
    } catch {
      const state = { id: randId(), born: now };
      localStorage.setItem("device_id_state", JSON.stringify(state));
      return state.id;
    }
  };

  const deviceId = getDeviceId();
  let lastPos = null;
  let lastSnapshot = null;
  let lastDangerSpokenAt = 0;

  const map = L.map("map", { zoomControl: false }).setView([13.0827, 80.2707], 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);

  const myDot = L.circleMarker([0, 0], {
    radius: 8,
    color: "#ffffff",
    weight: 2,
    fillColor: "#2b7cff",
    fillOpacity: 1,
  }).addTo(map);

  const heat = L.heatLayer([], { radius: 28, blur: 22, maxZoom: 17 }).addTo(map);
  const zoneLayer = L.layerGroup().addTo(map);
  const eventLayer = L.layerGroup().addTo(map);
  const routeLayer = L.layerGroup().addTo(map);
  let routeLine = null;
  let target = null;

  const haversineM = (a, b) => {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLon / 2);
    const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  const toXYm = (p, latRef) => {
    // Local equirectangular meters; good for short routing hints
    const mPerDegLat = 111_320;
    const mPerDegLon = 111_320 * Math.cos((latRef * Math.PI) / 180);
    return { x: p.lon * mPerDegLon, y: p.lat * mPerDegLat };
  };

  const closestPointOnSeg = (a, b, p) => {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
    return { x: a.x + t * abx, y: a.y + t * aby, t };
  };

  const planRoute = () => {
    if (!lastPos || !target || !lastSnapshot) return null;
    const A = { lat: lastPos.lat, lon: lastPos.lon };
    const B = { lat: target.lat, lon: target.lon };
    const latRef = (A.lat + B.lat) / 2;
    const a = toXYm(A, latRef), b = toXYm(B, latRef);

    let closest = { d: Infinity, red: null, foot: null };
    for (const z of lastSnapshot.zones || []) {
      if (z.level !== "red") continue;
      const pLL = { lat: z.centerLat, lon: z.centerLon };
      const p = toXYm(pLL, latRef);
      const foot = closestPointOnSeg(a, b, p);
      const dx = p.x - foot.x, dy = p.y - foot.y;
      const d = Math.hypot(dx, dy);
      if (d < closest.d) closest = { d, red: pLL, foot };
    }

    // If route comes close to a red zone, suggest a simple detour waypoint.
    if (closest.red && closest.d < 60) {
      const dirx = b.x - a.x, diry = b.y - a.y;
      const len = Math.hypot(dirx, diry) || 1;
      // Perpendicular unit vectors
      const px = -diry / len, py = dirx / len;

      // Pick the side that moves away from the red center
      const redXY = toXYm(closest.red, latRef);
      const footXY = { x: closest.foot.x, y: closest.foot.y };
      const side = ((redXY.x - footXY.x) * px + (redXY.y - footXY.y) * py) > 0 ? -1 : 1;

      const detourXY = { x: footXY.x + side * px * 120, y: footXY.y + side * py * 120 };
      const mPerDegLat = 111_320;
      const mPerDegLon = 111_320 * Math.cos((latRef * Math.PI) / 180) || 1;
      const detour = { lat: detourXY.y / mPerDegLat, lon: detourXY.x / mPerDegLon };
      return { kind: "detour", points: [A, detour, B] };
    }

    return { kind: "direct", points: [A, B] };
  };

  const drawRoute = () => {
    routeLayer.clearLayers();
    routeLine = null;
    const r = planRoute();
    if (!r) return;
    const latlngs = r.points.map((p) => [p.lat, p.lon]);
    routeLine = L.polyline(latlngs, { color: r.kind === "detour" ? "#ffcc00" : "#4ea3ff", weight: 5, opacity: 0.85 })
      .addTo(routeLayer);
    if (r.kind === "detour" && statusEl.textContent.startsWith("Live")) {
      statusEl.textContent = "Live (safer detour suggested)";
    } else if (r.kind === "direct" && statusEl.textContent === "Live (safer detour suggested)") {
      statusEl.textContent = "Live";
    }
  };

  const drawZones = (snap) => {
    zoneLayer.clearLayers();
    const points = [];
    for (const z of snap.zones || []) {
      const intensity = Math.min(1, (z.count || 1) / 10);
      points.push([z.centerLat, z.centerLon, intensity]);

      const color = z.level === "red" ? "#ff3b30" : z.level === "yellow" ? "#ffcc00" : "#34c759";
      const opacity = z.level === "red" ? 0.30 : z.level === "yellow" ? 0.22 : 0.14;
      const r = snap.cellSizeM / 2;
      // Draw as circle in meters for readable overlay
      L.circle([z.centerLat, z.centerLon], {
        radius: r,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: opacity,
      }).addTo(zoneLayer);
    }
    heat.setLatLngs(points);
    drawRoute();
  };

  const drawEvents = (snap) => {
    eventLayer.clearLayers();
    for (const ev of snap.events || []) {
      if (ev.status === "approved") {
        const marker = L.marker([ev.lat, ev.lon])
          .bindPopup(`<b>${ev.name}</b><br>Org: ${ev.organizer}<br><i>${new Date(ev.datetimeStr).toLocaleString()}</i><br>${ev.participants} expected<br>${ev.description}`);
        eventLayer.addLayer(marker);
      }
    }
  };

  const computeLocalRisk = () => {
    if (!lastPos || !lastSnapshot) return { level: "Unknown", nearestRedM: Infinity };
    let nearestRedM = Infinity;
    for (const z of lastSnapshot.zones || []) {
      if (z.level !== "red") continue;
      const d = haversineM({ lat: lastPos.lat, lon: lastPos.lon }, { lat: z.centerLat, lon: z.centerLon });
      if (d < nearestRedM) nearestRedM = d;
    }
    const level =
      nearestRedM <= CFG.DANGER_RADIUS_M ? "DANGER" :
      nearestRedM <= CFG.DANGER_RADIUS_M * 2 ? "CAUTION" :
      "SAFE";
    return { level, nearestRedM };
  };

  const maybeAlert = () => {
    const r = computeLocalRisk();
    setRisk(r.level);
    if (r.level === "DANGER") {
      const now = Date.now();
      if (supportsVibrate()) navigator.vibrate([200, 100, 200, 100, 300]);
      if (now - lastDangerSpokenAt > 12_000) {
        speak("Warning. Overcrowded area ahead. Please change route.");
        lastDangerSpokenAt = now;
      }
    }
  };

  const startGeolocation = async () => {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation not supported");
      return;
    }
    setStatus("Requesting GPS permission…");

    navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        lastPos = { lat: latitude, lon: longitude };
        myDot.setLatLng([latitude, longitude]);
        if (!map._movedOnce) {
          map.setView([latitude, longitude], 16);
          map._movedOnce = true;
        }
        maybeAlert();
        drawRoute();
      },
      (err) => {
        setStatus(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  };

  const connectWs = () => {
    setStatus("Connecting…");
    const ws = new WebSocket(CFG.WS_URL);

    ws.onopen = () => setStatus("Live");
    ws.onclose = () => {
      setStatus("Disconnected (retrying)");
      setTimeout(connectWs, 1500);
    };
    ws.onerror = () => setStatus("Connection error");

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot") {
          lastSnapshot = msg.data;
          drawZones(lastSnapshot);
          drawEvents(lastSnapshot);
          maybeAlert();
        }
      } catch {}
    };

    // Send location pings
    setInterval(() => {
      if (ws.readyState !== 1) return;
      if (!lastPos) return;
      const payload = {
        deviceId,
        lat: lastPos.lat,
        lon: lastPos.lon,
        ts: Date.now(),
      };
      ws.send(JSON.stringify(payload));
    }, CFG.PING_EVERY_MS);
  };

  const search = async (q) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
  };

  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const q = searchInput.value.trim();
    if (!q) return;
    setStatus("Searching…");
    try {
      const r = await search(q);
      if (!r) {
        setStatus("No results");
        return;
      }
      setStatus("Live");
      map.setView([r.lat, r.lon], 16);
      target = { lat: r.lat, lon: r.lon, label: r.label };
      drawRoute();
      L.popup({ closeButton: false })
        .setLatLng([r.lat, r.lon])
        .setContent(`<div style="font-weight:700">Search result</div><div style="opacity:.85;font-size:12px">${r.label}</div>`)
        .openOn(map);
    } catch {
      setStatus("Search failed");
    }
  });

  document.getElementById("locBtn").addEventListener("click", () => {
    if (!lastPos) return;
    map.setView([lastPos.lat, lastPos.lon], 16);
  });

  document.getElementById("contrastBtn").addEventListener("click", () => {
    document.body.classList.toggle("high-contrast");
  });
  document.getElementById("textBtn").addEventListener("click", () => {
    document.body.classList.toggle("large-text");
  });

  // NEW MODAL LOGIC
  const sosModal = document.getElementById("sosModal");
  const eventModal = document.getElementById("eventModal");

  // Event Button - Open Modal
  document.getElementById("eventBtn").addEventListener("click", () => {
    document.getElementById("eventForm").reset();
    const nowLocal = new Date();
    nowLocal.setMinutes(nowLocal.getMinutes() - nowLocal.getTimezoneOffset());
    document.getElementById("eventDate").value = nowLocal.toISOString().slice(0, 16);
    eventModal.style.display = "flex";
  });
  document.getElementById("cancelEventBtn").addEventListener("click", () => {
    eventModal.style.display = "none";
  });

  // Event Form Submit
  document.getElementById("eventForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!lastPos) {
      alert("Waiting for GPS location...");
      return;
    }
    const center = map.getCenter();
    const payload = {
      name: document.getElementById("eventName").value.trim(),
      organizer: document.getElementById("eventOrg").value.trim(),
      lat: center.lat,
      lon: center.lng,
      datetimeStr: document.getElementById("eventDate").value,
      participants: parseInt(document.getElementById("eventPax").value, 10),
      description: document.getElementById("eventDesc").value.trim()
    };
    
    try {
      const res = await fetch(`${CFG.API_BASE}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        alert("Event request submitted to admin for approval.");
        eventModal.style.display = "none";
      } else {
        alert("Failed to create event. Try again later.");
      }
    } catch (err) {
      alert("Network error.");
    }
  });

  // SOS Button - Open Modal
  document.getElementById("sosFloatBtn").addEventListener("click", () => {
    document.getElementById("sosPin").value = "";
    sosModal.style.display = "flex";
  });
  document.getElementById("cancelSosBtn").addEventListener("click", () => {
    sosModal.style.display = "none";
  });

  // Confirm SOS
  document.getElementById("confirmSosBtn").addEventListener("click", async () => {
    const pin = document.getElementById("sosPin").value;
    if (pin !== "1234") {
      alert("Invalid PIN. Default is 1234.");
      return;
    }
    if (!lastPos) {
      alert("Waiting for GPS location...");
      return;
    }
    const payload = {
      deviceId,
      lat: lastPos.lat,
      lon: lastPos.lon,
      pin
    };
    try {
      const res = await fetch(`${CFG.API_BASE}/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        sosModal.style.display = "none";
        speak("Emergency SOS sent.");
        if (supportsVibrate()) navigator.vibrate([120, 60, 120]);
        alert("SOS Alert activated!");
      } else {
        alert("Failed to trigger SOS.");
      }
    } catch {
      alert("Network error.");
    }
  });

  // PWA install + offline basics
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Start
  startGeolocation();
  connectWs();
  setRisk("Unknown");
})();

