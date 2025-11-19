export const BRIDGE_PARENT_SOURCE = 'arcade-parent';
export const BRIDGE_SOURCE = 'arcade-bridge';

export const BRIDGE_SCRIPT = String.raw`(() => {
  if (window.__arcadeBridge) return;

  const SOURCE = '${BRIDGE_SOURCE}';
  const PARENT_SOURCE = '${BRIDGE_PARENT_SOURCE}';
  const ORIGIN = window.origin;
  const originalConsole = {};
  const metricsState = {
    lastTimestamp: null,
    frameCount: 0,
    frameTimes: [],
    lastPost: performance.now(),
    firstPaint: null,
    start: performance.now()
  };
  let readySent = false;

  const serialize = (value) => {
    try {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'object') {
        return JSON.parse(JSON.stringify(value));
      }
      return String(value);
    } catch {
      return String(value);
    }
  };

  const post = (type, payload = {}) => {
    try {
      window.parent?.postMessage({ source: SOURCE, type, payload }, ORIGIN);
    } catch {
      // ignore
    }
  };

  const detectCanvas = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      width: canvas.width || rect.width,
      height: canvas.height || rect.height
    };
  };

  const sendReadyOnce = () => {
    if (readySent) return;
    const size = detectCanvas();
    if (size) {
      readySent = true;
      post('arcade:ready', { canvasSize: size, devicePixelRatio: window.devicePixelRatio || 1 });
    }
  };

  const recordFrame = (timestamp) => {
    if (metricsState.lastTimestamp != null) {
      const delta = timestamp - metricsState.lastTimestamp;
      metricsState.frameCount += 1;
      metricsState.frameTimes.push(delta);
      if (metricsState.frameTimes.length > 60) metricsState.frameTimes.shift();
      if (metricsState.firstPaint == null) {
        metricsState.firstPaint = performance.now() - metricsState.start;
      }
    }
    metricsState.lastTimestamp = timestamp;

    if (timestamp - metricsState.lastPost >= 100) {
      const frameCount = metricsState.frameTimes.length;
      let average = 0;
      if (frameCount > 0) {
        const sum = metricsState.frameTimes.reduce((acc, value) => acc + value, 0);
        average = sum / frameCount;
      }
      const fps = average > 0 ? 1000 / average : 0;

      post('arcade:metrics', {
        fps: Number.isFinite(fps) ? Number(fps.toFixed(2)) : 0,
        frameTimeMs: Number(average.toFixed(2)),
        frameSamples: frameCount,
        canvasSize: detectCanvas(),
        firstPaintMs: metricsState.firstPaint,
        devicePixelRatio: window.devicePixelRatio || 1
      });

      metricsState.frameCount = 0;
      metricsState.lastPost = timestamp;
    }
  };

  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function wrappedRequestAnimationFrame(callback) {
    return originalRequestAnimationFrame((timestamp) => {
      recordFrame(timestamp);
      sendReadyOnce();
      callback(timestamp);
    });
  };

  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const original = console[level];
    originalConsole[level] = original;
    console[level] = (...args) => {
      try {
        post('arcade:console', { level, args: args.map(serialize) });
      } catch {
        // ignore serialization problems
      }
      original?.apply(console, args);
    };
  });

  window.onerror = (message, source, lineno, colno, error) => {
    post('arcade:error', {
      message,
      source,
      line: lineno,
      column: colno,
      stack: error && error.stack ? error.stack : null
    });
  };

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.source !== PARENT_SOURCE) return;
    if (event.origin !== ORIGIN) return;
    const { type } = data;
    if (!type) return;

    switch (type) {
      case 'arcade:focus':
      case 'arcade:blur':
        case 'arcade:pause':
        case 'arcade:resume': {
          const evt = new CustomEvent(type);
          window.dispatchEvent(evt);
          document.dispatchEvent(evt);
          post('arcade:pause-state', { state: type });
          break;
        }
      case 'arcade:toggle-help': {
        const evt = new CustomEvent('arcade:toggle-help');
        window.dispatchEvent(evt);
        document.dispatchEvent(evt);
        break;
      }
      case 'arcade:request-highscores': {
        const entries = [];
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            entries.push({ key, value: window.localStorage.getItem(key) });
          }
        } catch (err) {
          post('arcade:error', {
            message: 'Failed to enumerate localStorage',
            stack: err instanceof Error ? err.stack : null
          });
        }
        post('arcade:highscores', { entries });
        break;
      }
      default:
        break;
    }
  });

  const observer = new MutationObserver(() => sendReadyOnce());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => sendReadyOnce());
  window.addEventListener('load', () => sendReadyOnce());
  setTimeout(() => sendReadyOnce(), 0);

  window.__arcadeBridge = {
    restoreConsole() {
      Object.entries(originalConsole).forEach(([level, original]) => {
        console[level] = original;
      });
    }
  };
})();`;
