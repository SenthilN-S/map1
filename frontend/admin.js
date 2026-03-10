/* global L */
(() => {
  const CFG = window.CROWD_CONFIG;
  const devicesEl = document.getElementById("devicesText");
  const redEl = document.getElementById("redText");
  const incEl = document.getElementById("incText");
  const yellowInput = document.getElementById("yellowInput");
  const redInput = document.getElementById("redInput");
  const cfgText = document.getElementById("cfgText");

  const map = L.map("map", { zoomControl: false }).setView([13.0827, 80.2707], 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

  const heat = L.heatLayer([], { radius: 32, blur: 24, maxZoom: 17 }).addTo(map);
  const zones = L.layerGroup().addTo(map);
  const incidents = L.layerGroup().addTo(map);

  let lastSnap = null;

  const draw = (snap) => {
    lastSnap = snap;
    zones.clearLayers();
    incidents.clearLayers();

    const pts = [];
    let redCount = 0;
    for (const z of snap.zones || []) {
      const intensity = Math.min(1, (z.count || 1) / 10);
      pts.push([z.centerLat, z.centerLon, intensity]);

      const color = z.level === "red" ? "#ff3b30" : z.level === "yellow" ? "#ffcc00" : "#34c759";
      const opacity = z.level === "red" ? 0.33 : z.level === "yellow" ? 0.23 : 0.14;
      if (z.level === "red") redCount += 1;

      L.circle([z.centerLat, z.centerLon], {
        radius: snap.cellSizeM / 2,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: opacity,
      }).bindPopup(
        `<div style="font-weight:700">${z.level.toUpperCase()}</div><div>Devices: ${z.count}</div><div>Density: ${z.densityPerM2.toFixed(3)} /m²</div>`
      ).addTo(zones);
    }
    heat.setLatLngs(pts);

    for (const i of snap.incidents || []) {
      L.circleMarker([i.lat, i.lon], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#ff3b30",
        fillOpacity: 0.95,
      }).bindPopup(
        `<div style="font-weight:700">INCIDENT</div><div style="opacity:.9">${(i.message || "").replaceAll("<","&lt;")}</div><div style="opacity:.7;font-size:12px">${new Date(i.ts).toLocaleString()}</div>`
      ).addTo(incidents);
    }

    const activeDevices = (snap.zones || []).reduce((a, z) => a + (z.count || 0), 0);
    devicesEl.textContent = String(activeDevices);
    redEl.textContent = String(redCount);
    incEl.textContent = String((snap.incidents || []).length);
  };

  const connectWs = () => {
    const ws = new WebSocket(CFG.WS_URL);
    ws.onclose = () => setTimeout(connectWs, 1500);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "snapshot") draw(msg.data);
      } catch {}
    };
  };

  const loadConfig = async () => {
    try {
      const res = await fetch(`${CFG.API_BASE}/config`);
      const c = await res.json();
      yellowInput.value = String(c.yellowMinCount ?? 3);
      redInput.value = String(c.redMinCount ?? 6);
      cfgText.textContent = `Yellow ≥ ${yellowInput.value}, Red ≥ ${redInput.value}`;
    } catch {
      cfgText.textContent = "failed to load";
    }
  };

  const applyConfig = async () => {
    const y = Math.max(1, Math.min(500, parseInt(yellowInput.value || "3", 10)));
    const r = Math.max(1, Math.min(500, parseInt(redInput.value || "6", 10)));
    yellowInput.value = String(y);
    redInput.value = String(r);
    try {
      const res = await fetch(`${CFG.API_BASE}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yellowMinCount: y, redMinCount: r }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(`Failed to update thresholds: ${t}`);
        return;
      }
      const c = await res.json();
      yellowInput.value = String(c.yellowMinCount ?? y);
      redInput.value = String(c.redMinCount ?? r);
      cfgText.textContent = `Yellow ≥ ${yellowInput.value}, Red ≥ ${redInput.value}`;
      alert("Thresholds updated (live).");
    } catch {
      alert("Failed to update thresholds.");
    }
  };

  document.getElementById("fitBtn").addEventListener("click", () => {
    if (!lastSnap || !(lastSnap.zones || []).length) return;
    const latlngs = lastSnap.zones.map((z) => [z.centerLat, z.centerLon]);
    const b = L.latLngBounds(latlngs);
    map.fitBounds(b.pad(0.3));
  });

  document.getElementById("applyBtn").addEventListener("click", applyConfig);

  loadConfig();
  connectWs();
})();

