import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const directory = "public/art/catalog";
const sources = JSON.parse((await readFile(`${directory}/sources.json`, "utf8")).replace(/^\uFEFF/, ""));
await mkdir(directory, { recursive: true });
for (const asset of sources) {
  const url = new URL(asset.source);
  if (url.protocol !== "https:" || !["cdn2.unrealengine.com", "shared.steamstatic.com"].includes(url.hostname) || path.basename(asset.file) !== asset.file) throw new Error("Unexpected catalog asset source.");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Artwork request failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2_000_000 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error(`Expected a small publisher JPEG: ${asset.file}`);
  await writeFile(`${directory}/${asset.file}`, bytes);
}
console.log(`Prepared ${sources.length} publisher artwork assets. Sources remain in ${directory}/sources.json.`);
