import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

loadDotEnv(path.join(__dirname, ".env"));

const appConfig = {
  googleApiKey: process.env.GOOGLE_API_KEY || "",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/healthz") {
      send(res, 200, "text/plain; charset=utf-8", "ok");
      return;
    }

    if (url.pathname === "/config.js") {
      const body = `window.APP_CONFIG = ${JSON.stringify(appConfig, null, 2)};\n`;
      send(res, 200, "application/javascript; charset=utf-8", body);
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(publicDir, normalizedPath);

    if (!filePath.startsWith(publicDir)) {
      send(res, 403, "text/plain; charset=utf-8", "Forbidden");
      return;
    }

    const file = await readFile(filePath);
    const extension = path.extname(filePath);
    send(res, 200, contentTypes[extension] || "application/octet-stream", file);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    const message = status === 404 ? "Not found" : "Server error";
    send(res, status, "text/plain; charset=utf-8", message);

    if (status === 500) {
      console.error(error);
    }
  }
});

server.listen(port, () => {
  console.log(`Random Drive media app running at http://localhost:${port}`);
});

function send(res, statusCode, contentType, body) {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

function loadDotEnv(envPath) {
  try {
    const content = readFileSyncCompat(envPath);

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("Unable to load .env file:", error.message);
    }
  }
}

function readFileSyncCompat(envPath) {
  return readFileSync(envPath, "utf8");
}
