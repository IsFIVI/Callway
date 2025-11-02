(function initCallwayConfig() {
  if (typeof window === "undefined") {
    return;
  }

  const defaultApiBase = "http://localhost:3001";

  if (!window.CALLWAY_API_BASE) {
    window.CALLWAY_API_BASE = defaultApiBase;
  }
})();
