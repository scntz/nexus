import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const output = [
  "NEXUS THIRD-PARTY LICENSES",
  "",
  "Project code is dual-licensed under MIT OR Apache-2.0, at your option. The following dependency notices retain their original ownership.",
  "Game artwork and platform trademarks are credited separately in public/art/ATTRIBUTION.md and public/brands/sources.json.",
  "",
];
let count = 0;
function append(name, version, license, directory, extraFile, repository) {
  const names = fs
    .readdirSync(directory)
    .filter(
      (entry) =>
        /^(?:licen[cs]e|copying|notice)(?:[-._]|$)/i.test(entry) &&
        fs.statSync(path.join(directory, entry)).isFile(),
    );
  const files = new Set(names.map((entry) => path.join(directory, entry)));
  if (extraFile) {
    const filename = path.resolve(directory, extraFile);
    if (fs.existsSync(filename) && fs.statSync(filename).isFile())
      files.add(filename);
  }
  output.push(
    "=".repeat(72),
    name + " " + version,
    "License declaration: " + (license || "See package notices"),
  );
  if (repository) output.push("Source: " + repository);
  for (const filename of files) {
    output.push(
      "",
      path.basename(filename),
      "",
      fs.readFileSync(filename, "utf8").trim(),
    );
  }
  output.push("");
  count++;
}

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--offline",
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
      "--manifest-path",
      "src-tauri/Cargo.toml",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
for (const pkg of metadata.packages.sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (pkg.name === "nexus") continue;
  append(
    pkg.name,
    pkg.version,
    pkg.license,
    path.dirname(pkg.manifest_path),
    pkg.license_file,
    pkg.repository,
  );
}

const seen = new Set();
function frontend(name) {
  const directory = path.join("node_modules", name);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "package.json"), "utf8"),
  );
  const key = manifest.name + "@" + manifest.version;
  if (seen.has(key)) return;
  seen.add(key);
  const repository =
    typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url;
  append(
    manifest.name,
    manifest.version,
    manifest.license,
    directory,
    null,
    repository,
  );
  for (const dependency of Object.keys(manifest.dependencies || {}))
    frontend(dependency);
}
for (const name of Object.keys(
  JSON.parse(fs.readFileSync("package.json", "utf8")).dependencies,
))
  frontend(name);
fs.mkdirSync("docs", { recursive: true });
const text = output
  .join("\n")
  .split(/\r?\n/)
  .map((line) => line.trimEnd())
  .join("\n")
  .trimEnd();
fs.writeFileSync("docs/THIRD_PARTY_LICENSES.txt", text + "\n");
console.log("Prepared notices for " + count + " dependency packages.");
