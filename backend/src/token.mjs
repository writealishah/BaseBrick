import crypto from "node:crypto";

function base64urlEncode(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64urlDecode(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padSize = (4 - (padded.length % 4)) % 4;
  const withPad = `${padded}${"=".repeat(padSize)}`;
  return Buffer.from(withPad, "base64").toString("utf8");
}

function hmacSha256(message, secret) {
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

export function createToken(payload, secret) {
  const serialized = base64urlEncode(JSON.stringify(payload));
  const sig = hmacSha256(serialized, secret);
  return `mb.${serialized}.${sig}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string") return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "mb") return { ok: false };
  const serialized = parts[1];
  const signature = parts[2];
  const expected = hmacSha256(serialized, secret);
  if (signature !== expected) return { ok: false };
  try {
    const payload = JSON.parse(base64urlDecode(serialized));
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}
