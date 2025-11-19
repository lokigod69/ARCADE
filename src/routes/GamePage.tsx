import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useManifest } from '../state/ManifestContext';
import type { GameManifestEntry } from '../types/manifest';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { injectBridgeScript, postToGame } from '../lib/injectBridge';
import { BRIDGE_SOURCE } from '../lib/bridgeScript';

interface CanvasSize {
  width: number;
  height: number;
}

const CONTROL_STYLE_ID = 'arcade-controls-style';

export default function GamePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getGame } = useManifest();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [containerRef, containerSize] = useResizeObserver<HTMLDivElement>();
  const [game, setGame] = useState<GameManifestEntry | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [nativeSize, setNativeSize] = useState<CanvasSize | null>(null);
  const [devicePixelRatio, setDevicePixelRatio] = useState<number | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [renderDimensions, setRenderDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });
  const [iframeHasFocus, setIframeHasFocus] = useState(false);
  const [doubleScale, setDoubleScale] = useState(false);
  const [hostControlsHidden, setHostControlsHidden] = useState(false);
  const scaleRaf = useRef<number | null>(null);
  const hostControlsHiddenRef = useRef(hostControlsHidden);
  const iframeFocusRef = useRef(iframeHasFocus);
  const detachFrameListeners = useRef<(() => void) | null>(null);
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    const nextGame = id ? getGame(id) : undefined;
    if (!nextGame || nextGame.status === 'missing-assets') {
      navigate('/', { replace: true });
      return;
    }
    setGame(nextGame);
    const dismissed = window.localStorage.getItem(`arcade:tutorialDismissed:${nextGame.id}`);
    setShowTutorial(!dismissed);
    hasNavigatedRef.current = false;
  }, [getGame, id, navigate]);

  useEffect(() => {
    iframeFocusRef.current = iframeHasFocus;
  }, [iframeHasFocus]);

  useEffect(() => {
    hostControlsHiddenRef.current = hostControlsHidden;
  }, [hostControlsHidden]);

  useEffect(() => {
    hasNavigatedRef.current = false;
  }, [id]);

  const applyControlsHiddenClass = useCallback(
    (hidden: boolean) => {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      if (!doc.getElementById(CONTROL_STYLE_ID)) {
        const style = doc.createElement('style');
        style.id = CONTROL_STYLE_ID;
        style.textContent = `
          body.arcade-controls-hidden #controls,
          body.arcade-controls-hidden #controls-tooltip,
          body.arcade-controls-hidden .controls,
          body.arcade-controls-hidden [data-controls],
          body.arcade-controls-hidden [id*="controls"] {
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
          }
        `;
        doc.head.appendChild(style);
      }
      doc.body.classList.toggle('arcade-controls-hidden', hidden);
    },
    []
  );

  useEffect(() => {
    applyControlsHiddenClass(hostControlsHidden);
  }, [applyControlsHiddenClass, hostControlsHidden]);

  const scheduleScaleUpdate = useCallback(() => {
    if (!nativeSize) return;
    if (scaleRaf.current) cancelAnimationFrame(scaleRaf.current);
    scaleRaf.current = requestAnimationFrame(() => {
      const hostWidth = containerSize.width;
      const hostHeight = containerSize.height;
      if (hostWidth === 0 || hostHeight === 0) return;
      const nextScale = Math.min(hostWidth / nativeSize.width, hostHeight / nativeSize.height);
      const clampedScale = Number.isFinite(nextScale) ? Math.max(nextScale, 0.1) : 1;

      const renderWidth = Math.round(nativeSize.width * clampedScale);
      const renderHeight = Math.round(nativeSize.height * clampedScale);
      setRenderScale(clampedScale);
      setRenderDimensions({ width: renderWidth, height: renderHeight });

      const canvas = iframeRef.current?.contentDocument?.querySelector('canvas') as
        | HTMLCanvasElement
        | undefined;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const ratio =
          canvas.width > 0 ? Math.abs(rect.width / canvas.width - 1) : Math.abs(rect.width - nativeSize.width);
        setDoubleScale(ratio > 0.05);
      }
    });
  }, [containerSize.height, containerSize.width, nativeSize]);

  useEffect(() => {
    scheduleScaleUpdate();
    return () => {
      if (scaleRaf.current) cancelAnimationFrame(scaleRaf.current);
    };
  }, [scheduleScaleUpdate, nativeSize]);

  const sendControl = useCallback((type: string) => {
    postToGame(iframeRef.current, type);
  }, []);

  const setActiveIframe = useCallback((active: boolean) => {
    iframeFocusRef.current = active;
    setIframeHasFocus(active);
  }, []);

  const toggleHostControls = useCallback(() => {
    const nextHidden = !hostControlsHiddenRef.current;
    hostControlsHiddenRef.current = nextHidden;
    setHostControlsHidden(nextHidden);
    applyControlsHiddenClass(nextHidden);
    sendControl('arcade:toggle-help');
  }, [applyControlsHiddenClass, sendControl]);

  const handleKeyPipeline = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key;
      if (!key) return;

      const lower = key.toLowerCase();
      if (event.repeat && (key === 'Escape' || lower === 'h')) {
        event.preventDefault();
        return;
      }

      if (key === 'Escape') {
        event.preventDefault();
        if (!hasNavigatedRef.current) {
          hasNavigatedRef.current = true;
          setActiveIframe(false);
          sendControl('arcade:pause');
          navigate('/');
        }
        return;
      }

      if (lower === 'h') {
        event.preventDefault();
        toggleHostControls();
      }
    },
    [navigate, sendControl, setActiveIframe, toggleHostControls]
  );

  const attachFrameListeners = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      detachFrameListeners.current?.();
      if (!iframe) return;

      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) return;

      const handleFocusIn = () => setActiveIframe(true);
      const handleFocusOut = () => setActiveIframe(false);
      const handleFrameKeyDown = (event: KeyboardEvent) => {
        setActiveIframe(true);
        handleKeyPipeline(event);
      };

      iframe.addEventListener('focusin', handleFocusIn);
      iframe.addEventListener('focusout', handleFocusOut);
      iframe.addEventListener('focus', handleFocusIn);
      iframe.addEventListener('blur', handleFocusOut);
      doc.addEventListener('focusin', handleFocusIn);
      doc.addEventListener('focusout', handleFocusOut);
      win.addEventListener('focus', handleFocusIn);
      win.addEventListener('blur', handleFocusOut);
      win.addEventListener('keydown', handleFrameKeyDown, true);

      detachFrameListeners.current = () => {
        iframe.removeEventListener('focusin', handleFocusIn);
        iframe.removeEventListener('focusout', handleFocusOut);
        iframe.removeEventListener('focus', handleFocusIn);
        iframe.removeEventListener('blur', handleFocusOut);
        doc.removeEventListener('focusin', handleFocusIn);
        doc.removeEventListener('focusout', handleFocusOut);
        win.removeEventListener('focus', handleFocusIn);
        win.removeEventListener('blur', handleFocusOut);
        win.removeEventListener('keydown', handleFrameKeyDown, true);
      };
    },
    [handleKeyPipeline, setActiveIframe]
  );

  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (!iframeFocusRef.current) return;
      handleKeyPipeline(event);
    };
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true);
  }, [handleKeyPipeline]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      switch (data.type) {
        case 'arcade:ready':
          if (data.payload?.canvasSize) {
            setNativeSize(data.payload.canvasSize);
          }
          if (typeof data.payload?.devicePixelRatio === 'number') {
            setDevicePixelRatio(data.payload.devicePixelRatio);
          }
          break;
        case 'arcade:metrics':
          if (typeof data.payload?.devicePixelRatio === 'number') {
            setDevicePixelRatio(data.payload.devicePixelRatio);
          }
          break;
        case 'arcade:focus':
          setActiveIframe(true);
          break;
        case 'arcade:blur':
        case 'arcade:pause-state':
          setActiveIframe(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setActiveIframe]);


  useEffect(() => {
    return () => {
      sendControl('arcade:blur');
    };
  }, [sendControl]);

  if (!game) {
    return null;
  }

  const computedNative = nativeSize ?? { width: 800, height: 600 };
  const movementControls = game.controls?.movement ?? [];
  const combatControls = game.controls?.combat ?? [];
  const metaControls = game.controls?.meta ?? [];

  const dismissTutorial = () => {
    window.localStorage.setItem(`arcade:tutorialDismissed:${game.id}`, '1');
    setShowTutorial(false);
  };

  const handlePointerDown = () => {
    iframeRef.current?.focus();
    setActiveIframe(true);
  };

  useEffect(
    () => () => {
      detachFrameListeners.current?.();
    },
    []
  );

  return (
    <div className="flex h-[100vh] w-[100vw] flex-col overflow-hidden bg-slate-950 text-white">
      <header className="border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-sm text-slate-400">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-slate-200 transition hover:text-white focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
              >
                Back to Launcher
              </Link>
            </p>
            <h1 className="mt-2 text-2xl font-semibold">{game.title}</h1>
            <p className="text-sm text-slate-400">{game.description}</p>
            <p className="text-xs text-slate-500">
              Native {computedNative.width}×{computedNative.height} · Render{' '}
              {renderDimensions.width}×{renderDimensions.height} · Scale {renderScale.toFixed(3)} · DPR{' '}
              {devicePixelRatio !== null ? devicePixelRatio.toFixed(2) : 'n/a'} · Double scale:{' '}
              {doubleScale ? 'on' : 'off'}
            </p>
          </div>
          <Link
            to="/dev/tools"
            className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-1.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
          >
            Open Dev Tools
          </Link>
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="relative flex h-full w-full items-center justify-center bg-slate-900"
          onPointerDown={handlePointerDown}
        >
          <div className="pointer-events-none absolute left-4 top-4 z-30 flex h-6 items-center rounded-full border border-slate-600/60 bg-slate-900/80 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
            H: controls
          </div>

          {showTutorial && (
            <div className="absolute right-6 top-6 z-30 w-full max-w-sm rounded-2xl border border-white/10 bg-slate-950/90 p-5 shadow-2xl backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-fuchsia-300">
                  Quick Controls
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Review movement, combat, and meta bindings before you dive in. You can reopen by clearing
                  localStorage.
                </p>
                {game.id === 'afterglow' && (
                  <p className="mt-2 text-xs text-teal-300">
                    Tip: Hold the mouse to charge a flare, release or tap Space to ignite. Press P to pause and R to reset after defeat.
                  </p>
                )}
              </div>
                <button
                  type="button"
                  aria-label="Dismiss tutorial overlay"
                  className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
                  onClick={dismissTutorial}
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-4 text-xs">
                {movementControls.length > 0 && (
                  <div>
                    <p className="font-semibold text-slate-200">Movement</p>
                    <ul className="mt-1 space-y-1 text-slate-400">
                      {movementControls.map((control, index) => (
                        <li key={`${control.device}-${control.input}-${index}`}>
                          <span className="font-mono text-slate-300">{control.input}</span> &mdash;{' '}
                          {control.action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {combatControls.length > 0 && (
                  <div>
                    <p className="font-semibold text-slate-200">Combat</p>
                    <ul className="mt-1 space-y-1 text-slate-400">
                      {combatControls.map((control, index) => (
                        <li key={`${control.device}-${control.input}-${index}`}>
                          <span className="font-mono text-slate-300">{control.input}</span> &mdash;{' '}
                          {control.action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {metaControls.length > 0 && (
                  <div>
                    <p className="font-semibold text-slate-200">Meta</p>
                    <ul className="mt-1 space-y-1 text-slate-400">
                      {metaControls.map((control, index) => (
                        <li key={`${control.device}-${control.input}-${index}`}>
                          <span className="font-mono text-slate-300">{control.input}</span> &mdash;{' '}
                          {control.action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className="absolute left-1/2 top-1/2 transition-transform"
            style={{
              width: computedNative.width,
              height: computedNative.height,
              transform: `translate(-50%, -50%) scale(${renderScale})`,
              transformOrigin: 'top left',
              imageRendering: 'pixelated'
            }}
          >
            <iframe
              key={game.entry}
              ref={iframeRef}
              tabIndex={-1}
              src={`/${game.entry}`}
              title={game.title}
              className="block h-full w-full rounded-xl border-0 bg-black"
              sandbox="allow-scripts allow-pointer-lock allow-same-origin"
              allow="gamepad *; fullscreen"
              onLoad={() => {
                const iframe = iframeRef.current;
                if (!iframe) return;
                injectBridgeScript(iframe);
                attachFrameListeners(iframe);
                scheduleScaleUpdate();
                applyControlsHiddenClass(hostControlsHiddenRef.current);
                iframe.focus();
                setActiveIframe(true);
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
