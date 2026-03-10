// Update these when deploying.
window.CROWD_CONFIG = {
  WS_URL: "ws://localhost:8000/ws",
  API_BASE: "http://localhost:8000",
  // How often to send GPS pings (ms)
  PING_EVERY_MS: 3000,
  // Device ID rotation for privacy (ms)
  DEVICE_ID_ROTATE_MS: 30 * 60 * 1000,
  // Alert when within this distance of a red cell (meters)
  DANGER_RADIUS_M: 35,
};

