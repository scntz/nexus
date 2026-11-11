import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const roots = process.argv.slice(2);
const privateTerms = [
  os.userInfo().username,
  os.hostname(),
  ...JSON.parse(process.env.NEXUS_PRIVACY_TERMS || "[]"),
].filter((value) => typeof value === "string" && value.length >= 4);
const identityPatterns = privateTerms.map((term) => {
  const escaped = term.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
  return new RegExp("(?<![a-z0-9_])" + escaped + "(?![a-z0-9_])", "i");
});
const patterns = [
  ["user directory", /[a-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+/i],
  ["home directory", /\/(?:home|Users)\/[a-z0-9_.-]+\//i],
  [
    "access token",
    /(?:gh[pousr]_[a-z0-9]{30,}|github_pat_[a-z0-9_]{50,}|AKIA[A-Z0-9]{16})/i,
  ],
  [
    "private key",
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[a-z0-9+/=]{32}/i,
  ],
  ["account identifier", /7656119\d{10}/],
];
const forbiddenSource =
  /(?:^|\/)(?:artifacts|release|node_modules|dist|target|target-[^/]+|\.git|\.codex|\.agents)(?:\/|$)|(?:^|\/)\.env(?:$|\.(?!example$))|\.(?:pfx|key|pem|pdb|dmp)$/i;
const files = [];
function utf16Text(bytes, offset) {
  if (bytes.length <= offset) return "";
  const end = bytes.length - ((bytes.length - offset) % 2);
  return Buffer.from(bytes.subarray(offset, end)).toString("utf16le");
}
function collect(filename) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink())
    throw new Error("Release input contains a symbolic link.");
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(filename))
      collect(path.join(filename, entry));
  } else files.push(filename);
}
if (roots.length) {
  for (const root of roots) collect(root);
} else {
  files.push(
    ...execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean),
  );
}
const failures = [];
for (const filename of files) {
  const relative = path.relative(process.cwd(), filename).replaceAll("\\", "/");
  if (!roots.length && forbiddenSource.test(relative))
    failures.push({
      file: relative,
      reason: "private or generated source path",
    });
  const bytes = fs.readFileSync(filename);
  const representations = [
    bytes.toString("utf8"),
    utf16Text(bytes, 0),
    utf16Text(bytes, 1),
  ];
  for (const [reason, pattern] of patterns) {
    if (representations.some((value) => pattern.test(value)))
      failures.push({ file: relative, reason });
  }
  if (
    identityPatterns.some((pattern) =>
      representations.some((value) => pattern.test(value)),
    )
  ) {
    failures.push({ file: relative, reason: "local identity marker" });
  }
}
if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ passed: true, filesChecked: files.length }));
}
