import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useManifest } from '../state/ManifestContext';
import { useResizeObserver } from '../hooks/useResizeObserver';
import { injectBridgeScript, postToGame } from '../lib/injectBridge';
import { BRIDGE_SOURCE } from '../lib/bridgeScript';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';
type ConsoleFilter = 'all' | 'error' | 'warn' | 'info';

interface CanvasSize {
  width: number;
  height: number;
}

interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  args: unknown[];
  timestamp: number;
}

interface ErrorEntry {
  id: string;
  message: string;
  stack?: string | null;
  count: number;
  timestamp: number;
}

interface MetricsSample {
  fps: number;
  frameTimeMs: number;
  frameSamples: number;
  canvasSize?: CanvasSize | null;
  firstPaintMs?: number | null;
  devicePixelRatio?: number | null;
  timestamp: number;
}

interface HighscoreEntry {
  key: string;
  value: string | null;
}

const KNOWN_HIGHSCORE_KEYS = [
  'cosmicRunnerHighScore',
  'gravityFlipHighScore',
  'impulseHighScore',
  'spaceInvadersHighScore'
];

const CONSOLE_FILTERS: { label: string; value: ConsoleFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Errors', value: 'error' },
  { label: 'Warnings', value: 'warn' },
  { label: 'Info', value: 'info' }
];

const matchesFilter = (level: ConsoleLevel, filter: ConsoleFilter) => {
  if (filter === 'all') return true;
  if (filter === 'info') return level === 'info' || level === 'log';
  return level === filter;
};

export default function DevToolsPage() {
  const { games } = useManifest();
  const defaultGame = games[0];
  const [selectedId, setSelectedId] = useState<string>(defaultGame?.id ?? '');
  const selectedGame = games.find((game) => game.id === selectedId) ?? defaultGame;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [containerRef, containerSize] = useResizeObserver<HTMLDivElement>();

  const [nativeSize, setNativeSize] = useState<CanvasSize | null>(null);
  const [devicePixelRatio, setDevicePixelRatio] = useState<number | null>(null);
  const [renderSize, setRenderSize] = useState<{ width: number; height: number; scale: number }>({
    width: 0,
    height: 0,
    scale: 1
  });
  const scaleRaf = useRef<number | null>(null);

  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [consoleFilter, setConsoleFilter] = useState<ConsoleFilter>('all');
  const [errorEntries, setErrorEntries] = useState<Map<string, ErrorEntry>>(new Map());
  const [metricsHistory, setMetricsHistory] = useState<MetricsSample[]>([]);
  const [highscores, setHighscores] = useState<HighscoreEntry[]>([]);
  const [thumbnailExists, setThumbnailExists] = useState<boolean | null>(null);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [repoExclusions, setRepoExclusions] = useState<Set<string>>(new Set());
  const [localExclusions, setLocalExclusions] = useState<Set<string>>(new Set());
  const [testPreset, setTestPreset] = useState<{ width: number; height: number } | null>(null);
  const renderScaleRef = useRef(1);

  useEffect(() => {
    setConsoleEntries([]);
    setConsoleFilter('all');
    setErrorEntries(new Map());
    setMetricsHistory([]);
    setHighscores([]);
    setNativeSize(null);
    setDevicePixelRatio(null);
    setThumbnailExists(null);
    setSnapshotStatus(null);
    setRenderSize({ width: 0, height: 0, scale: 1 });
    setTestPreset(null);
  }, [selectedId]);

  useEffect(() => {
    const gatherLocal = () => {
      const excluded = new Set<string>();
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('arcade:exclude:')) {
          excluded.add(key.replace('arcade:exclude:', ''));
        }
      });
      setLocalExclusions(excluded);
    };

    gatherLocal();

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith('arcade:exclude:')) return;
      gatherLocal();
    };

    const handleCustom = () => gatherLocal();

    window.addEventListener('storage', handleStorage);
    window.addEventListener('arcade-exclude-changed', handleCustom as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('arcade-exclude-changed', handleCustom as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('docs/exclude.json', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (!cancelled && Array.isArray(data)) {
          setRepoExclusions(new Set(data.filter((entry): entry is string => typeof entry === 'string')));
        }
      })
      .catch(() => {
        /* optional file */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scheduleScaleUpdate = useCallback(() => {
    if (!nativeSize) return;
    if (scaleRaf.current) cancelAnimationFrame(scaleRaf.current);
    scaleRaf.current = requestAnimationFrame(() => {
      const { width: hostW, height: hostH } = containerSize;
      if (hostW === 0 || hostH === 0) return;
      const baseScale = Math.min(hostW / nativeSize.width, hostH / nativeSize.height);
      const safeScale = Number.isFinite(baseScale) ? Math.max(baseScale, 0.1) : 1;
      const renderWidth = Math.round(nativeSize.width * safeScale);
      const renderHeight = Math.round(nativeSize.height * safeScale);
      const adjustedScale = nativeSize.width > 0 ? renderWidth / nativeSize.width : 1;
      setRenderSize({ width: renderWidth, height: renderHeight, scale: adjustedScale });
    });
  }, [containerSize, nativeSize]);

  useEffect(() => {
    scheduleScaleUpdate();
    return () => {
      if (scaleRaf.current) cancelAnimationFrame(scaleRaf.current);
    };
  }, [scheduleScaleUpdate, nativeSize, testPreset]);

  const sendControl = useCallback(
    (type: string, payload?: unknown) => {
      postToGame(iframeRef.current, type, payload);
    },
    []
  );

  const requestHighscores = useCallback(() => {
    sendControl('arcade:request-highscores');
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return;
    try {
      const entries: HighscoreEntry[] = [];
      KNOWN_HIGHSCORE_KEYS.forEach((key) => {
        const value = targetWindow.localStorage.getItem(key);
        if (value !== null) {
          entries.push({ key, value });
        }
      });
      if (entries.length > 0) {
        setHighscores(entries);
      }
    } catch {
      // ignore cross-origin or blocked access
    }
  }, [sendControl]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedGame) {
      setThumbnailExists(null);
      return;
    }
    const expectedPath = `thumbnails/${selectedGame.id}.png`;
    fetch(`/${expectedPath}`, { method: 'HEAD' })
      .then((response) => {
        if (!cancelled) setThumbnailExists(response.ok);
      })
      .catch(() => {
        if (!cancelled) setThumbnailExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGame]);

  useEffect(() => {
    renderScaleRef.current = renderSize.scale;
  }, [renderSize.scale]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE) return;
      const timestamp = Date.now();

      switch (data.type) {
        case 'arcade:ready':
          if (data.payload?.canvasSize) {
            setNativeSize(data.payload.canvasSize);
          }
          if (data.payload?.devicePixelRatio) {
            setDevicePixelRatio(data.payload.devicePixelRatio);
          }
          break;
        case 'arcade:metrics':
          setMetricsHistory((prev) => {
            const next: MetricsSample[] = [
              ...prev.slice(-119),
              {
                ...data.payload,
                timestamp
              }
            ];
            return next;
          });
          if (data.payload?.devicePixelRatio) {
            setDevicePixelRatio(data.payload.devicePixelRatio);
          }
          break;
        case 'arcade:console': {
          const level = (data.payload?.level ?? 'log') as ConsoleLevel;
          setConsoleEntries((prev) => [
            ...prev.slice(-199),
            {
              id: `${timestamp}-${prev.length}`,
              level,
              args: data.payload?.args ?? [],
              timestamp
            }
          ]);
          break;
        }
        case 'arcade:error': {
          setErrorEntries((prev) => {
            const key = `${data.payload?.message ?? 'error'}::${data.payload?.stack ?? 'nostack'}`;
            const next = new Map(prev);
            const existing = next.get(key);
            if (existing) {
              next.set(key, { ...existing, count: existing.count + 1, timestamp });
            } else {
              next.set(key, {
                id: key,
                message: data.payload?.message ?? 'Unknown error',
                stack: data.payload?.stack ?? null,
                count: 1,
                timestamp
              });
            }
            return next;
          });
          break;
        }
        case 'arcade:highscores':
          if (Array.isArray(data.payload?.entries)) {
            setHighscores(data.payload.entries);
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  useEffect(() => {
    return () => {
      sendControl('arcade:blur');
    };
  }, [sendControl, selectedId]);

  const handleIframeLoad = useCallback(() => {
    if (!iframeRef.current) return;
    injectBridgeScript(iframeRef.current);
    sendControl('arcade:focus');
    requestHighscores();
    scheduleScaleUpdate();
  }, [requestHighscores, scheduleScaleUpdate, sendControl]);

  const averageFps = useMemo(() => {
    if (metricsHistory.length === 0) return null;
    const sum = metricsHistory.reduce((acc, sample) => acc + (sample.fps ?? 0), 0);
    return Number((sum / metricsHistory.length).toFixed(2));
  }, [metricsHistory]);

  const latestMetrics = metricsHistory.at(-1);
  const totalErrorCount = useMemo(
    () => Array.from(errorEntries.values()).reduce((acc, entry) => acc + entry.count, 0),
    [errorEntries]
  );

  const consoleLog = useMemo(
    () => consoleEntries.filter((entry) => matchesFilter(entry.level, consoleFilter)),
    [consoleEntries, consoleFilter]
  );

  const topErrors = useMemo(
    () =>
      Array.from(errorEntries.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    [errorEntries]
  );

  const renderScaleDisplay = useMemo(() => renderSize.scale.toFixed(3), [renderSize.scale]);

  const captureSnapshot = async () => {
    if (!selectedGame) return;
    const doc = iframeRef.current?.contentDocument;
    const canvas = doc?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      setSnapshotStatus('Canvas not found. Start the game to capture a snapshot.');
      return;
    }
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${selectedGame.id}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSnapshotStatus(
        `Snapshot downloaded. Move it to public/thumbnails/${selectedGame.id}.png and rerun pnpm check.`
      );
    } catch (error) {
      setSnapshotStatus(
        error instanceof Error
          ? error.message
          : 'Unable to capture snapshot. See console for details.'
      );
    }
  };

  const copyReport = async () => {
    if (!selectedGame) return;
    const lines = [
      `# Arcade Dev Tools Report`,
      ``,
      `- **Game:** ${selectedGame.title} (${selectedGame.id})`,
      `- **Status:** ${selectedGame.status}`,
      `- **Description:** ${selectedGame.description}`,
      `- **Native Size:** ${
        nativeSize ? `${nativeSize.width}x${nativeSize.height}` : 'n/a'
      }`,
      `- **Render Size:** ${
        renderSize.width && renderSize.height
          ? `${renderSize.width}x${renderSize.height} (scale ${renderScaleDisplay})`
          : 'n/a'
      }`,
      `- **Device Pixel Ratio:** ${devicePixelRatio ?? 'n/a'}`,
      `- **Average FPS:** ${averageFps ?? 'n/a'}`,
      `- **Latest Frame Time:** ${latestMetrics ? `${latestMetrics.frameTimeMs} ms` : 'n/a'}`,
      `- **First Paint:** ${
        latestMetrics?.firstPaintMs != null ? `${latestMetrics.firstPaintMs.toFixed(1)} ms` : 'n/a'
      }`,
      `- **Error Count (captured):** ${totalErrorCount}`,
      ``,
      `## Top Errors`,
      '',
      ...(topErrors.length === 0
        ? ['_No errors recorded._']
        : topErrors.map(
            (entry) =>
              `- ${entry.message} (x${entry.count})${
                entry.stack ? `\n\`\`\`\n${entry.stack}\n\`\`\`` : ''
              }`
          )),
      '',
      `## High Scores`,
      '',
      ...(highscores.length === 0
        ? ['_No high score data available._']
        : highscores.map((entry) => `- ${entry.key}: ${entry.value ?? 'n/a'}`)),
      '',
      `## Recent Console Entries`,
      '',
      ...(consoleEntries.slice(-10).map(
        (entry) =>
          `- [${entry.level}] ${entry.args.map((arg) => JSON.stringify(arg)).join(' ')}`
      ) || [])
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch (error) {
      console.error('Failed to copy report', error);
    }
  };

  if (!selectedGame) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-white">
        <p>No games available.</p>
        <Link to="/" className="mt-4 rounded bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white">
          Back to Launcher
        </Link>
      </div>
    );
  }

  const visibleConsoleEntries = consoleLog;

  const isRepoHidden = selectedGame ? repoExclusions.has(selectedGame.id) : false;
  const isLocalHidden = selectedGame ? localExclusions.has(selectedGame.id) : false;
  const isHidden = isRepoHidden || isLocalHidden;

  const handleToggleHide = useCallback(() => {
    if (!selectedGame) return;
    const key = `arcade:exclude:${selectedGame.id}`;
    const next = new Set(localExclusions);
    if (next.has(selectedGame.id)) {
      next.delete(selectedGame.id);
      localStorage.removeItem(key);
    } else {
      next.add(selectedGame.id);
      localStorage.setItem(key, 'true');
    }
    setLocalExclusions(next);
    window.dispatchEvent(new Event('arcade-exclude-changed'));
  }, [localExclusions, selectedGame]);

  const handleSaveExclusions = useCallback(() => {
    const combined = Array.from(new Set([...repoExclusions, ...localExclusions]));
    const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'exclude.json';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }, [localExclusions, repoExclusions]);

  const runScaleTest = useCallback(() => {
    const presets: Array<{ label: string; width: number; height: number }> = [
      { label: 'sm', width: 640, height: 360 },
      { label: 'md', width: 1024, height: 576 },
      { label: 'lg', width: 1280, height: 720 }
    ];
    let index = 0;
    const runNext = () => {
      const preset = presets[index];
      setTestPreset({ width: preset.width, height: preset.height });
      setTimeout(() => {
        console.info(
          `[dev-tools] scale ${preset.label}: ${renderScaleRef.current.toFixed(3)}`
        );
        index += 1;
        if (index < presets.length) {
          runNext();
        } else {
          setTimeout(() => setTestPreset(null), 500);
        }
      }, 350);
    };
    runNext();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-semibold">Developer Tools</h1>
            <p className="text-sm text-slate-400">
              Inspect console output, runtime metrics, and high scores for each game.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="rounded-full border border-transparent px-4 py-1.5 text-sm font-semibold text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
            >
              Back to Launcher
            </Link>
            <button
              type="button"
              className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-1.5 text-sm font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
              onClick={copyReport}
            >
              Copy Markdown Report
            </button>
          </div>
        </div>
      </header>

  <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-10">
        <section className="mb-8">
          <label className="block text-sm font-semibold text-slate-300">
            Select game
            <select
              value={selectedGame.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-2 w-full rounded border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:ring focus:ring-fuchsia-400"
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.title}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="mb-10 rounded-2xl border border-white/5 bg-slate-900/70 p-4">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Inline preview
          </h2>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span>
              {thumbnailExists
                ? 'Snapshot detected in public/thumbnails.'
                : 'No saved snapshot found. Capture one to replace the launcher placeholder.'}
            </span>
            <button
              type="button"
              className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1 font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
              onClick={captureSnapshot}
            >
              Capture Snapshot
            </button>
          </div>
          {snapshotStatus && (
            <p className="mb-4 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200">
              {snapshotStatus}
            </p>
          )}
          <div
            ref={containerRef}
            className="relative flex min-h-[420px] w-full items-center justify-center rounded-xl bg-slate-950"
            style={
              testPreset
                ? { width: `${testPreset.width}px`, height: `${testPreset.height}px` }
                : undefined
            }
            onPointerDown={() => sendControl('arcade:focus')}
          >
            <div
              className="absolute left-1/2 top-1/2 transition-transform"
              style={{
                width: nativeSize?.width ?? 800,
                height: nativeSize?.height ?? 600,
                transform: `translate(-50%, -50%) scale(${renderSize.scale})`,
                transformOrigin: 'top left',
                imageRendering: 'pixelated'
              }}
            >
              <iframe
                key={`${selectedGame.id}-${selectedGame.entry}`}
                ref={iframeRef}
                src={`/${selectedGame.entry}`}
                title={`${selectedGame.title} Diagnostic`}
                className="block h-full w-full rounded border-0 bg-black"
                sandbox="allow-scripts allow-pointer-lock allow-same-origin"
                allow="gamepad *; fullscreen"
                onLoad={handleIframeLoad}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-6">
            <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Launcher visibility
              </h3>
              <p className="mt-2 text-xs text-slate-400">
                Hide this game from the launcher without touching the manifest. Local exclusions sync via
                localStorage; use the download button to export <code>docs/exclude.json</code> for commits.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                <button
                  type="button"
                  onClick={handleToggleHide}
                  className={`rounded-full border px-3 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400 ${
                    isLocalHidden
                      ? 'border-red-500/60 bg-red-500/20 text-red-200'
                      : 'border-slate-600 bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {isLocalHidden ? 'Remove local hide' : 'Hide in launcher'}
                </button>
                <button
                  type="button"
                  onClick={handleSaveExclusions}
                  className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
                >
                  Save exclusions to repo
                </button>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between">
                  <dt>Repo exclusion</dt>
                  <dd className="text-slate-200">{isRepoHidden ? 'yes' : 'no'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Local exclusion</dt>
                  <dd className="text-slate-200">{isLocalHidden ? 'yes' : 'no'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Effective state</dt>
                  <dd className="text-slate-200">{isHidden ? 'hidden' : 'visible'}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
                onClick={runScaleTest}
              >
                Run scale test
              </button>
              {testPreset && (
                <p className="mt-2 text-xs text-slate-500">
                  Test viewport: {testPreset.width}×{testPreset.height}
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Metrics
              </h3>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-slate-400">Native size</dt>
                  <dd className="text-white">
                    {nativeSize ? `${nativeSize.width}x${nativeSize.height}` : 'n/a'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Render size</dt>
                  <dd className="text-white">
                    {renderSize.width && renderSize.height
                      ? `${renderSize.width}x${renderSize.height} (scale ${renderScaleDisplay})`
                      : 'n/a'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Device pixel ratio</dt>
                  <dd className="text-white">{devicePixelRatio ?? 'n/a'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Average FPS</dt>
                  <dd className="text-white">{averageFps ?? 'n/a'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Last frame time</dt>
                  <dd className="text-white">
                    {latestMetrics ? `${latestMetrics.frameTimeMs} ms` : 'n/a'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">First paint</dt>
                  <dd className="text-white">
                    {latestMetrics?.firstPaintMs != null
                      ? `${latestMetrics.firstPaintMs.toFixed(1)} ms`
                      : 'n/a'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">Error count</dt>
                  <dd className="text-white">{totalErrorCount}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  High scores
                </h3>
                <button
                  type="button"
                  className="text-xs font-semibold text-fuchsia-300 hover:text-fuchsia-200 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
                  onClick={requestHighscores}
                >
                  Refresh
                </button>
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {highscores.length === 0 ? (
                  <li className="text-slate-500">No entries reported.</li>
                ) : (
                  highscores.map((entry) => (
                    <li key={entry.key} className="flex justify-between">
                      <span className="text-slate-400">{entry.key}</span>
                      <span className="text-white">{entry.value ?? 'n/a'}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  Console (latest 200)
                </h3>
                <div className="flex gap-2 text-xs">
                  {CONSOLE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      type="button"
                      className={`rounded-full px-2.5 py-1 font-semibold transition focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400 ${
                        consoleFilter === filter.value
                          ? 'bg-fuchsia-500/20 text-fuchsia-200'
                          : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
                      }`}
                      onClick={() => setConsoleFilter(filter.value)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 max-h-64 overflow-auto rounded border border-white/5 bg-slate-950/70 p-3 text-xs leading-relaxed">
                {visibleConsoleEntries.length === 0 ? (
                  <p className="text-slate-500">No console output recorded yet.</p>
                ) : (
                  visibleConsoleEntries.map((entry) => (
                    <div key={entry.id} className="mb-2 last:mb-0">
                      <span
                        className={`mr-2 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                          entry.level === 'error'
                            ? 'bg-red-500/20 text-red-300'
                            : entry.level === 'warn'
                            ? 'bg-amber-500/20 text-amber-200'
                            : 'bg-slate-800 text-slate-200'
                        }`}
                      >
                        {entry.level}
                      </span>
                      <span className="text-slate-200">
                        {entry.args.map((arg, index) => (
                          <span key={index} className="mr-2">
                            {typeof arg === 'string' ? arg : JSON.stringify(arg)}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-slate-900/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                Errors
              </h3>
              <div className="mt-3 max-h-64 overflow-auto rounded border border-white/5 bg-slate-950/70 p-3 text-xs leading-relaxed">
                {errorEntries.size === 0 ? (
                  <p className="text-slate-500">No errors captured.</p>
                ) : (
                  topErrors.map((entry) => (
                    <div key={entry.id} className="mb-3 last:mb-0">
                      <p className="font-semibold text-red-300">
                        {entry.message} (x{entry.count})
                      </p>
                      {entry.stack && (
                        <pre className="mt-1 whitespace-pre-wrap break-words text-slate-400">
                          {entry.stack}
                        </pre>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
