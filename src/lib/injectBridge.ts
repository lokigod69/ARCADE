import { BRIDGE_PARENT_SOURCE, BRIDGE_SCRIPT } from './bridgeScript';

export function injectBridgeScript(iframe: HTMLIFrameElement) {
  const doc = iframe.contentDocument;
  if (!doc || doc.querySelector('script[data-arcade-bridge="true"]')) {
    return;
  }
  const script = doc.createElement('script');
  script.dataset.arcadeBridge = 'true';
  script.textContent = BRIDGE_SCRIPT;
  doc.documentElement.appendChild(script);
}

export function postToGame(iframe: HTMLIFrameElement | null, type: string, payload?: unknown) {
  const targetWindow = iframe?.contentWindow;
  if (!targetWindow) return;
  targetWindow.postMessage({ source: BRIDGE_PARENT_SOURCE, type, payload }, window.location.origin);
}
