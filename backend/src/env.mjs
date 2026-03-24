import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function parseEnvText(raw) {
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith("#")) continue;
    const eq = clean.indexOf("=");
    if (eq <= 0) continue;
    const key = clean.slice(0, eq).trim();
    const value = clean.slice(eq + 1).trim();
    map[key] = value;
  }
  return map;
}

export function loadDotEnv(cwd = process.cwd()) {
  const file = path.join(cwd, ".env");
  if (!fs.existsSync(file)) return;
  const parsed = parseEnvText(fs.readFileSync(file, "utf8"));
  Object.entries(parsed).forEach(([key, value]) => {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  });
}
