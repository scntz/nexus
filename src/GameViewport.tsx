import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Game } from "./types";

export function visibleRange(
  count: number,
  columns: number,
  rowHeight: number,
  scroll: number,
  height: number,
) {
  const rows = Math.ceil(count / columns);
  if (!rows) return { start: 0, end: 0, top: 0, bottom: 0 };
  const first = Math.min(
    Math.max(0, rows - 1),
    Math.max(0, Math.floor(scroll / rowHeight) - 2),
  );
  const last = Math.min(
    rows,
    Math.max(first + 1, Math.ceil((scroll + height) / rowHeight) + 2),
  );
  return {
    start: Math.min(count, first * columns),
    end: Math.min(count, last * columns),
    top: first * rowHeight,
    bottom: Math.max(0, (rows - last) * rowHeight),
  };
}

const initialLimit = 30;
const emptyRange = { start: 0, end: initialLimit, top: 0, bottom: 0 };
const cardControl = ".cover-button, .game-title";

function mountedCardIndex(grid: HTMLElement, target: EventTarget | null): number {
  if (!(target instanceof Element) || !target.matches(cardControl)) return -1;
  const card = target.closest(".game-card");
  return card?.parentElement === grid
    ? Array.prototype.indexOf.call(grid.children, card)
    : -1;
}

/** Only visible rows and two overscan rows are mounted, independent of library size. */
export function GameViewport({
  games,
  layout,
  compact,
  children,
}: {
  games: Game[];
  layout: "grid" | "list";
  compact: boolean;
  children: (game: Game, index: number) => ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const geometry = useRef<{ columns: number; rowHeight: number }>();
  const pendingFocus = useRef<number>();
  const scheduleRange = useRef<() => void>();
  const hintId = useId();
  const [range, setRange] = useState(emptyRange);
  const [fallbackLimit, setFallbackLimit] = useState(initialLimit);
  const [measured, setMeasured] = useState(false);
  const current =
    measured && range.start < games.length
      ? range
      : { ...emptyRange, end: fallbackLimit };
  const currentStart = useRef(current.start);
  currentStart.current = current.start;

  useLayoutEffect(() => {
    const node = ref.current;
    const grid = gridRef.current;
    if (!node || !grid || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    let geometryDirty = true;
    let lastWidth = -1;
    let lastViewportHeight = -1;
    const measure = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0) return;
      const viewportHeight = window.innerHeight;
      const resized =
        lastWidth >= 0 &&
        (rect.width !== lastWidth || viewportHeight !== lastViewportHeight);
      lastViewportHeight = viewportHeight;
      if (geometryDirty || lastWidth !== rect.width || !geometry.current) {
        const cardHeight =
          grid.firstElementChild?.getBoundingClientRect().height ?? 0;
        if (!cardHeight) return;
        const style = getComputedStyle(grid);
        const columns =
          layout === "list"
            ? 1
            : Math.max(1, style.gridTemplateColumns.trim().split(/\s+/).length);
        geometry.current = {
          columns,
          rowHeight: cardHeight + (parseFloat(style.rowGap) || 0),
        };
        geometryDirty = false;
        lastWidth = rect.width;
      }
      const { columns, rowHeight } = geometry.current;
      const focusedOffset = resized
        ? mountedCardIndex(grid, document.activeElement)
        : -1;
      const anchor = resized
        ? (pendingFocus.current ??
          (focusedOffset >= 0 ? currentStart.current + focusedOffset : undefined))
        : undefined;
      // Mount the focused row at its new position before restoring focus.
      if (anchor !== undefined) pendingFocus.current = anchor;
      const next = visibleRange(
        games.length,
        columns,
        rowHeight,
        anchor === undefined
          ? Math.max(0, -rect.top)
          : Math.max(0, (Math.floor(anchor / columns) - 1) * rowHeight),
        Math.max(0, viewportHeight - Math.max(0, rect.top)),
      );
      setMeasured(true);
      setRange((old) =>
        anchor === undefined &&
        old.start === next.start &&
        old.end === next.end &&
        Math.abs(old.top - next.top) < 1 &&
        Math.abs(old.bottom - next.bottom) < 1
          ? old
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = () => {
      geometryDirty = true;
      schedule();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    if (node.parentElement) observer.observe(node.parentElement);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", resize);
    scheduleRange.current = schedule;
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
      scheduleRange.current = undefined;
    };
  }, [games.length, layout, compact]);

  function focusCard(index: number) {
    const card = gridRef.current?.children[index - current.start];
    const button = card?.querySelector<HTMLButtonElement>(cardControl);
    if (!button) return false;
    button.focus({ preventScroll: true });
    button.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    return true;
  }

  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === undefined) return;
    if (index >= games.length || focusCard(index))
      pendingFocus.current = undefined;
  });

  function navigateCards(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    const grid = gridRef.current;
    if (!grid) return;
    const mountedIndex = mountedCardIndex(grid, event.target);
    if (mountedIndex < 0) return;
    const index = pendingFocus.current ?? current.start + mountedIndex;
    const { columns, rowHeight } = geometry.current ?? {
      columns: 1,
      rowHeight: 100,
    };
    const last = measured
      ? games.length - 1
      : Math.min(current.end, games.length) - 1;
    const page =
      Math.max(1, Math.floor(window.innerHeight / rowHeight)) * columns;
    const destinations: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index - columns,
      ArrowDown: index + columns,
      PageUp: index - page,
      PageDown: index + page,
      Home: 0,
      End: last,
    };
    const destination = destinations[event.key];
    if (destination === undefined) return;
    event.preventDefault();
    const next = Math.min(last, Math.max(0, destination));
    if (next === index) return;
    if (focusCard(next)) {
      pendingFocus.current = undefined;
      return;
    }
    if (!ref.current || !geometry.current) return;
    pendingFocus.current = next;
    const viewportTop =
      window.scrollY + ref.current.getBoundingClientRect().top;
    window.scrollTo({
      top: Math.max(
        0,
        viewportTop + Math.floor(next / columns) * rowHeight - 100,
      ),
      behavior: "instant",
    });
    scheduleRange.current?.();
  }

  return (
    <div
      class="game-viewport"
      ref={ref}
      role="region"
      aria-label="Game results"
      aria-describedby={hintId}
      style={{
        paddingTop: current.top,
        paddingBottom: current.bottom,
      }}
    >
      <p class="sr-only" id={hintId}>
        Use the arrow keys to move between games. Home and End jump to the first
        and last game.
      </p>
      <div class={`game-${layout}`} ref={gridRef} onKeyDown={navigateCards}>
        {games
          .slice(current.start, current.end)
          .map((game, index) => children(game, current.start + index))}
      </div>
      {!measured && fallbackLimit < games.length && (
        <div class="load-more">
          <button
            class="button secondary small"
            onClick={() => setFallbackLimit((n) => n + 60)}
          >
            Show more games ({games.length - fallbackLimit} remaining)
          </button>
        </div>
      )}
    </div>
  );
}
