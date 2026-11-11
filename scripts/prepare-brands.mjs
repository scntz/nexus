import { mkdir, writeFile, readFile } from "node:fs/promises";
import {
  siSteam,
  siEpicgames,
  siGogdotcom,
  siEa,
  siUbisoft,
  siBattledotnet,
} from "simple-icons";

await mkdir("public/brands", { recursive: true });
const icons = [
  siSteam,
  siEpicgames,
  siGogdotcom,
  siEa,
  siUbisoft,
  siBattledotnet,
];
const sources = [];
for (const icon of icons) {
  const fill = icon.slug === "battledotnet" ? `#${icon.hex}` : "#ffffff";
  await writeFile(
    `public/brands/${icon.slug}.svg`,
    icon.svg.replace("<svg ", `<svg fill="${fill}" `),
  );
  sources.push({
    name: icon.title,
    file: `${icon.slug}.svg`,
    source: icon.source,
    collection: "Simple Icons 16.35.0",
    collectionUrl: "https://simpleicons.org",
    guidelines: icon.guidelines,
  });
}
const xboxUrl =
  "https://cms-assets.xboxservices.com/assets/5c/00/5c000795-0763-433f-9f5b-29a9c792d9e9.png?n=favicon-32x32.png";
const response = await fetch(xboxUrl);
if (!response.ok)
  throw new Error(`Xbox asset download failed: ${response.status}`);
const xbox = Buffer.from(await response.arrayBuffer());
if (xbox[0] !== 137 || xbox[1] !== 80)
  throw new Error("Expected the official Xbox PNG.");
await writeFile("public/brands/xbox.png", xbox);
sources.push({
  name: "Xbox",
  file: "xbox.png",
  source: xboxUrl,
  website: "https://www.xbox.com/en-US/",
});
await writeFile("public/brands/sources.json", JSON.stringify(sources, null, 2));
const fonts = await Promise.all(
  ["dm-sans", "manrope"].map(
    async (name) =>
      `\n\n${name}\n${await readFile(`node_modules/@fontsource-variable/${name}/LICENSE`, "utf8")}`,
  ),
);
const simpleLicense = await readFile(
  "node_modules/simple-icons/LICENSE.md",
  "utf8",
).catch(() => readFile("node_modules/simple-icons/LICENSE", "utf8"));
const lucideLicense = await readFile(
  "node_modules/lucide-preact/LICENSE",
  "utf8",
);
await writeFile(
  "public/THIRD_PARTY_NOTICES.txt",
  `NEXUS THIRD PARTY NOTICES\n\nPlatform trademarks belong to their respective owners and identify the source of each game. Nexus is independent and unaffiliated with these platforms.\n\nSteam and the Steam logo are trademarks and/or registered trademarks of Valve Corporation in the U.S. and/or other countries.\n\nAsset sources: brands/sources.json\n\nSIMPLE ICONS\n${simpleLicense}\n\nLUCIDE\n${lucideLicense}${fonts.join("")}`,
);
console.log(
  `Prepared ${sources.length} authentic local platform assets and third-party notices.`,
);
