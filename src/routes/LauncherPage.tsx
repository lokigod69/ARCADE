import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useManifest } from '../state/ManifestContext';
import type { GameManifestEntry } from '../types/manifest';
import placeholderThumbnail from '../assets/thumbnail-placeholder.svg';

const statusColors: Record<string, string> = {
  working: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  broken: 'bg-red-500/20 text-red-300 border border-red-500/40',
  flaky: 'bg-amber-500/20 text-amber-200 border border-amber-500/40',
  unknown: 'bg-slate-500/20 text-slate-200 border border-slate-500/40'
};

const hiddenChipStyles =
  'bg-slate-700/40 text-slate-200 border border-slate-400/40 bg-[repeating-linear-gradient(135deg,rgba(148,163,184,0.25),rgba(148,163,184,0.25) 8px,rgba(71,85,105,0.25) 8px,rgba(71,85,105,0.25) 16px)]';

function GameCard({
  game,
  disabled,
  hidden,
  statusLabel
}: {
  game: GameManifestEntry;
  disabled: boolean;
  hidden: boolean;
  statusLabel: string;
}) {
  const navigate = useNavigate();
  const [thumbSrc, setThumbSrc] = useState<string>(() => game.thumbnail ?? placeholderThumbnail);

  const handleActivate = () => {
    if (disabled) return;
    navigate(`/game/${game.id}`);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={handleActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleActivate();
        }
      }}
      className={`group relative overflow-hidden rounded-2xl border border-white/5 bg-slate-900/80 text-left shadow-lg outline-none transition focus-visible:ring focus-visible:ring-fuchsia-400 ${
        disabled ? 'opacity-60 saturate-50' : 'hover:-translate-y-1'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-t-2xl bg-slate-900">
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <img
            src={thumbSrc}
            alt=""
            className="max-h-full max-w-full object-contain transition duration-700 group-hover:scale-105"
            onError={() => setThumbSrc(placeholderThumbnail)}
            loading="lazy"
          />
        </div>
        <span
          className={`absolute bottom-3 left-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            hidden ? hiddenChipStyles : statusColors[game.status] ?? statusColors.unknown
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="space-y-3 px-4 pb-5 pt-4">
        <h2 className="truncate text-lg font-semibold text-white">{game.title}</h2>
        <p className="line-clamp-2 text-sm text-slate-400">{game.description}</p>
        {game.tags && game.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {game.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-800/80 px-2.5 py-1 text-xs uppercase tracking-wide text-slate-300"
              >
                {tag}
              </span>
            ))}
            {game.tags.length > 3 && (
              <span className="text-xs uppercase tracking-wide text-slate-500">
                +{game.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

export default function LauncherPage() {
  const { games } = useManifest();
  const [showHidden, setShowHidden] = useState(false);
  const [repoExclusions, setRepoExclusions] = useState<Set<string>>(new Set());
  const [localExclusions, setLocalExclusions] = useState<Set<string>>(new Set());

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
          setRepoExclusions(new Set(data.filter((item): item is string => typeof item === 'string')));
        }
      })
      .catch(() => {
        /* optional file */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveExcluded = useMemo(() => {
    return new Set<string>([...repoExclusions, ...localExclusions]);
  }, [localExclusions, repoExclusions]);

  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      if (game.status === 'missing-assets') return false;
      const isBroken = game.status === 'broken';
      const isHidden = effectiveExcluded.has(game.id);
      if (!showHidden && (isBroken || isHidden)) {
        return false;
      }
      return true;
    });
  }, [effectiveExcluded, games, showHidden]);

  const hiddenCount = useMemo(() => {
    let count = 0;
    games.forEach((game) => {
      if (game.status === 'broken' || effectiveExcluded.has(game.id)) {
        count += 1;
      }
    });
    return count;
  }, [effectiveExcluded, games]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-900 to-slate-900 text-white">
      <header className="border-b border-white/5 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <div>
            <h1 className="text-3xl font-black tracking-tight">ARCADEv1</h1>
            <p className="text-sm text-slate-400">A curated collection of experimental mini-games.</p>
          </div>
          <nav className="flex items-center gap-4 text-sm font-semibold">
            <Link
              to="/"
              className="rounded-full border border-transparent px-3 py-1.5 text-white/80 transition hover:text-white focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
            >
              Launcher
            </Link>
            <Link
              to="/dev/tools"
              className="rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-4 py-1.5 text-fuchsia-200 transition hover:bg-fuchsia-500/20 focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400"
            >
              Dev Tools
            </Link>
          </nav>
        </div>
        <div className="mx-auto flex w-full max-w-6xl items-center justify-end px-6 pb-4">
          <button
            type="button"
            role="switch"
            aria-checked={showHidden}
            onClick={() => setShowHidden((prev) => !prev)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring focus-visible:ring-fuchsia-400 ${
              showHidden
                ? 'border-red-500/60 bg-red-500/10 text-red-200'
                : 'border-slate-600 bg-slate-800/80 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full transition ${
                showHidden ? 'bg-red-400' : 'bg-slate-500'
              }`}
            />
            Show broken/hidden
            <span className="text-slate-500">({hiddenCount})</span>
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-4">
        {filteredGames.length === 0 ? (
          <div className="rounded-2xl border border-white/5 bg-slate-900/80 p-10 text-center text-sm text-slate-400">
            No games available. Enable "Show broken/hidden" to inspect excluded titles.
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredGames.map((game) => {
              const isBroken = game.status === 'broken';
              const isHidden = effectiveExcluded.has(game.id);
              const statusLabel = isHidden ? 'Hidden' : game.status;
              return (
                <GameCard
                  key={game.id}
                  game={game}
                  disabled={isBroken}
                  hidden={isHidden}
                  statusLabel={statusLabel}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
