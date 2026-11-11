/// <reference types="node" />
import { it, expect } from "vitest";
import { filterGames } from "./library";
import { groupGames } from "./duplicates";
import type { Game } from "./types";
import { writeFileSync, mkdirSync } from "node:fs";
import { cpus } from "node:os";
import { APP_VERSION } from "./version";
it("measures indexed search and grouping at 1k, 10k, and 50k games", () => {
  const results = [];
  for (const count of [1000, 10000, 50000]) {
    const games: Game[] = Array.from({ length: count }, (_, i) => ({
      id: `perf-${i}`,
      name: `${i % 5 === 0 ? "Adventure" : "Racing"} ${i}`,
      platform: i % 2 ? "Steam" : "Epic Games",
      installed: i % 3 === 0,
      favorite: i % 7 === 0,
      lastPlayed: i,
      genre: i % 5 === 0 ? "Adventure" : "Racing",
    }));
    const options = {
      query: "",
      platform: "all",
      tab: "all",
      sort: "name",
    } as const;
    const cold = performance.now();
    filterGames(games, options);
    const coldMs = performance.now() - cold;
    const times = [];
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      const found = filterGames(games, {
        ...options,
        query: i % 2 ? "adventure" : "racing",
      });
      expect(found.length).toBeGreaterThan(0);
      times.push(performance.now() - start);
    }
    const begin = performance.now();
    expect(groupGames(games)).toHaveLength(count);
    const groupingMs = performance.now() - begin;
    times.sort((a, b) => a - b);
    results.push({
      games: count,
      coldIndexMs: +coldMs.toFixed(2),
      medianSearchMs: +times[7].toFixed(2),
      p95SearchMs: +times[14].toFixed(2),
      groupingMs: +groupingMs.toFixed(2),
    });
  }
  if (process.env.NEXUS_BENCH) {
    mkdirSync("artifacts", { recursive: true });
    writeFileSync(
      `artifacts/library-performance-${APP_VERSION}.json`,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          node: process.version,
          cpu: cpus()[0]?.model,
          results,
          note: "Node functional benchmark. 15 warm queries per library; not a browser frame-time or controlled desktop benchmark.",
        },
        null,
        2,
      ),
    );
  }
}, 20000);
