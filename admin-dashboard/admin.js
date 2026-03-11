/* global L */
(() => {
  const CFG = window.CROWD_CONFIG;
  const devicesEl = document.getElementById("devicesText");
  const redEl = document.getElementById("redText");
  const incEl = document.getElementById("incText");
  const yellowInput = document.getElementById("yellowInput");
  const redInput = document.getElementById("redInput");
  const cfgText = document.getElementById("cfgText");

  const map = L.map("map", { 
    zoomControl: false,
    closePopupOnClick: false // Prevent closing popups when clicking map
  }).setView([13.0827, 80.2707], 13);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

  const heat = L.heatLayer([], { radius: 32, blur: 24, maxZoom: 17 }).addTo(map);
  const zones = L.layerGroup().addTo(map);
  const incidents = L.layerGroup().addTo(map);
  const eventsLayer = L.layerGroup().addTo(map);
  const sosLayer = L.layerGroup().addTo(map);
  
  const sosContainer = document.getElementById("sosContainer");
  const eventsListEl = document.getElementById("eventsList");

  const historyBtn = document.getElementById("historyBtn");
  const historyDrawer = document.getElementById("historyDrawer");
  const historyOverlay = document.getElementById("historyOverlay");
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  const historyEventsEl = document.getElementById("historyEvents");
  const historySosEl = document.getElementById("historySos");

  let lastSnap = null;
  const resolvedSosIds = new Set(); // Track locally resolved SOS IDs

  // Persistence Maps
  const markerCache = {
    sos: new Map(),
    incidents: new Map(),
    events: new Map()
  };

  const draw = (snap) => {
    lastSnap = snap;
    zones.clearLayers();
    // No longer clearing incidents, eventsLayer, or sosLayer here!
    // We manage them statefully within the draw function.

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

    // --- INCIDENTS ---
    const freshIncIds = new Set();
    for (const i of snap.incidents || []) {
      const id = `${i.lat}_${i.lon}_${i.ts}`;
      freshIncIds.add(id);
      if (!markerCache.incidents.has(id)) {
        const m = L.circleMarker([i.lat, i.lon], {
          radius: 7, color: "#ff9500", weight: 2, fillColor: "#ff9500", fillOpacity: 0.85,
        }).bindPopup(
          `<div style="font-weight:700; color:#ff9500">⚠️ INCIDENT</div><div style="opacity:.9">${(i.message || "").replaceAll("<","&lt;")}</div><div style="opacity:.7;font-size:12px">${new Date(i.ts).toLocaleString()}</div>`
        ).addTo(incidents);
        markerCache.incidents.set(id, m);
      }
    }
    for (const [id, m] of markerCache.incidents) {
      if (!freshIncIds.has(id)) {
        incidents.removeLayer(m);
        markerCache.incidents.delete(id);
      }
    }

    // --- EVENTS ---
    const freshEventIds = new Set();
    for (const ev of snap.events || []) {
      if (ev.status === "approved") {
        freshEventIds.add(ev.eventId);
        if (!markerCache.events.has(ev.eventId)) {
          const m = L.marker([ev.lat, ev.lon])
            .bindPopup(`<b>${ev.name}</b><br>Org: ${ev.organizer}<br><i>${new Date(ev.datetimeStr).toLocaleString()}</i><br>${ev.participants} expected<br>${ev.description}`)
            .addTo(eventsLayer);
          markerCache.events.set(ev.eventId, m);
        }
      }
    }
    for (const [id, m] of markerCache.events) {
      if (!freshEventIds.has(id)) {
        eventsLayer.removeLayer(m);
        markerCache.events.delete(id);
      }
    }

    // --- SOS ---
    const freshSosIds = new Set();
    for (const sos of snap.sosAlerts || []) {
      if (!sos.resolved && !resolvedSosIds.has(sos.sosId)) {
        freshSosIds.add(sos.sosId);
        if (!markerCache.sos.has(sos.sosId)) {
          const m = L.circleMarker([sos.lat, sos.lon], {
            radius: 12, color: "#ffffff", weight: 3, fillColor: "#ff3b30", fillOpacity: 1
          }).bindPopup(`<b>🚨 SOS ALERT</b><br>Device: ${sos.deviceId.substring(0,8)}...<br>Time: ${new Date(sos.ts).toLocaleTimeString()}`)
            .addTo(sosLayer);
          markerCache.sos.set(sos.sosId, m);
          
          if (!document.getElementById(`sos-pop-${sos.sosId}`)) {
            const div = document.createElement("div");
            div.className = "sos-popup";
            div.id = `sos-pop-${sos.sosId}`;
            div.innerHTML = `
              <h3>🚨 SOS ALERT <span>${new Date(sos.ts).toLocaleTimeString()}</span></h3>
              <p>Immediate assistance required at marked location.</p>
              <div style="display:flex; justify-content:flex-end">
                <button class="btn" style="background:#fff; color:#000; outline:none; border:none; padding:8px 16px; border-radius:8px; font-weight:bold" onclick="resolveSos('${sos.sosId}')">MARK RESOLVED</button>
              </div>
            `;
            sosContainer.appendChild(div);
            
            try {
              const u = new SpeechSynthesisUtterance("Emergency SOS received.");
              window.speechSynthesis.speak(u);
            } catch {}
            map.setView([sos.lat, sos.lon], 16);
          }
        } else {
          // Update position if it changed
          markerCache.sos.get(sos.sosId).setLatLng([sos.lat, sos.lon]);
        }
      }
    }
    for (const [id, m] of markerCache.sos) {
      if (!freshSosIds.has(id)) {
        sosLayer.removeLayer(m);
        markerCache.sos.delete(id);
      }
    }

    const activeDevices = (snap.zones || []).reduce((a, z) => a + (z.count || 0), 0);
    devicesEl.textContent = String(activeDevices);
    redEl.textContent = String(redCount);
    incEl.textContent = String((snap.incidents || []).length);

    for (const child of Array.from(sosContainer.children)) {
      const id = child.id.replace("sos-pop-", "");
      if (!freshSosIds.has(id)) {
        child.remove();
      }
    }
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

  // History Logic
  const openHistory = async () => {
    historyDrawer.classList.add("active");
    historyOverlay.classList.add("active");
    loadHistoryData();
  };

  const closeHistory = () => {
    historyDrawer.classList.remove("active");
    historyOverlay.classList.remove("active");
  };

  historyBtn.addEventListener("click", openHistory);
  closeHistoryBtn.addEventListener("click", closeHistory);
  historyOverlay.addEventListener("click", closeHistory);

  window.switchTab = (tab) => {
    document.querySelectorAll(".history-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".history-content").forEach(c => c.style.display = "none");
    
    if (tab === 'events') {
      document.getElementById("tabEvents").classList.add("active");
      historyEventsEl.style.display = "flex";
    } else {
      document.getElementById("tabSos").classList.add("active");
      historySosEl.style.display = "flex";
    }
  };

  const loadHistoryData = async () => {
    await Promise.all([loadEventHistory(), loadSosHistory()]);
  };

  const loadEventHistory = async () => {
    try {
      const res = await fetch(`${CFG.API_BASE}/events`);
      const events = await res.json();
      historyEventsEl.innerHTML = events.length === 0 ? '<p>No event requests yet.</p>' : 
        events.sort((a,b) => b.eventId.localeCompare(a.eventId)).map(e => `
          <div class="history-item ${e.status}">
            <h4>${e.name} <span class="ts">${new Date(e.datetimeStr).toLocaleString()}</span></h4>
            <p><b>Organizer:</b> ${e.organizer}</p>
            <p><b>Expected:</b> ${e.participants}</p>
            <p>${e.description}</p>
            <span class="status-badge ${e.status}">${e.status}</span>
          </div>
        `).join("");
    } catch {
      historyEventsEl.innerHTML = '<p class="danger">Failed to load event history.</p>';
    }
  };

  const loadSosHistory = async () => {
    try {
      const res = await fetch(`${CFG.API_BASE}/sos`);
      const sosList = await res.json();
      historySosEl.innerHTML = sosList.length === 0 ? '<p>No SOS alerts yet.</p>' : 
        sosList.sort((a,b) => b.ts - a.ts).map(s => `
          <div class="history-item sos ${s.resolved ? 'resolved' : ''}" style="cursor:pointer" onclick="focusMarker(${s.lat}, ${s.lon}, '${s.sosId}', 'sos')">
            <h4>🚨 SOS Alert <span class="ts">${new Date(s.ts).toLocaleString()}</span></h4>
            <p><b>Device:</b> ${s.deviceId.substring(0,12)}...</p>
            <p><b>Location:</b> ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</p>
            <span class="status-badge ${s.resolved ? 'resolved' : 'active-sos'}">${s.resolved ? 'Resolved' : 'Active'}</span>
          </div>
        `).join("");
    } catch {
      historySosEl.innerHTML = '<p class="danger">Failed to load SOS history.</p>';
    }
  };

  document.getElementById("clearIncBtn").addEventListener("click", async () => {
    if (!confirm("Clear all incident markers from the map?")) return;
    try {
      await fetch(`${CFG.API_BASE}/incidents`, { method: "DELETE" });
    } catch {
      alert("Failed to clear incidents.");
    }
  });

  const loadEvents = async () => {
    try {
      const res = await fetch(`${CFG.API_BASE}/events`);
      const events = await res.json();
      const pending = events.filter(e => e.status === "pending");
      
      if (pending.length === 0) {
        eventsListEl.innerHTML = '<div style="opacity:0.5; font-size:13px">No pending events.</div>';
        return;
      }
      
      eventsListEl.innerHTML = pending.map(e => `
        <div class="event-item">
          <b>${e.name}</b>
          <div>Org: ${e.organizer}</div>
          <div>Pax: ${e.participants}</div>
          <div>When: ${new Date(e.datetimeStr).toLocaleString()}</div>
          <div style="opacity:0.8; margin-top:4px">${e.description}</div>
          <div class="event-actions">
            <button class="btn primary" onclick="updateEvent('${e.eventId}', 'approved')">Accept</button>
            <button class="btn" onclick="updateEvent('${e.eventId}', 'declined')">Decline</button>
          </div>
        </div>
      `).join("");
    } catch {
      eventsListEl.innerHTML = '<div style="opacity:0.5; font-size:13px; color:var(--danger)">Failed to load events.</div>';
    }
  };

  window.updateEvent = async (eventId, status) => {
    try {
      await fetch(`${CFG.API_BASE}/events/${eventId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      loadEvents();
    } catch {
      alert("Failed to update event status");
    }
  };

  window.resolveSos = async (sosId) => {
    // Track as resolved locally so WebSocket broadcasts don't re-draw this marker
    resolvedSosIds.add(sosId);
    // Immediately remove the popup and map marker for instant feedback
    const popEl = document.getElementById(`sos-pop-${sosId}`);
    if (popEl) popEl.remove();
    sosLayer.clearLayers();
    try {
      await fetch(`${CFG.API_BASE}/sos/${sosId}/resolve`, { method: "POST" });
    } catch {
      alert("Failed to resolve SOS. Please try again.");
    }
  };

  window.focusMarker = (lat, lon, id, type) => {
    map.setView([lat, lon], 17);
    if (id && type) {
      const cache = markerCache[type];
      if (cache && cache.has(id)) {
        cache.get(id).openPopup();
      }
    } else {
      L.popup({ closeButton: false })
        .setLatLng([lat, lon])
        .setContent(`<div style="font-weight:700">Search result</div><div style="opacity:.85;font-size:12px">Location focused</div>`)
        .openOn(map);
    }
    closeHistory();
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
    try {
      const r = await search(q);
      if (!r) {
        alert("No results found.");
        return;
      }
      focusMarker(r.lat, r.lon);
    } catch {
      alert("Search failed.");
    }
  });

  setInterval(loadEvents, 10000); // refresh pending list

  loadConfig();
  loadEvents();
  connectWs();
})();

