import fs from "node:fs";
import path from "node:path";

export function createAuditLogger(filePath) {
  const folder = path.dirname(filePath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }

  function write(event, payload = {}) {
    const line = JSON.stringify({
      event,
      at: new Date().toISOString(),
      ...payload
    });
    fs.appendFile(filePath, `${line}\n`, () => {});
  }

  return { write };
}
