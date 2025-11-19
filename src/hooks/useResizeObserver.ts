import { useCallback, useEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

export function useResizeObserver<T extends HTMLElement>(): [(instance: T | null) => void, Size] {
  const observerRef = useRef<ResizeObserver | null>(null);
  const elementRef = useRef<T | null>(null);
  const rafRef = useRef<number | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  const cleanup = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    observerRef.current?.disconnect();
    observerRef.current = null;
  };

  const callbackRef = useCallback((node: T | null) => {
    if (elementRef.current === node) return;
    cleanup();
    elementRef.current = node;

    if (node) {
      observerRef.current = new ResizeObserver(([entry]) => {
        const box = entry?.contentRect;
        if (box) {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            setSize({ width: box.width, height: box.height });
          });
        }
      });
      observerRef.current.observe(node);
      setSize({
        width: node.clientWidth,
        height: node.clientHeight
      });
    }
  }, []);

  useEffect(() => () => cleanup(), []);

  return [callbackRef, size];
}
