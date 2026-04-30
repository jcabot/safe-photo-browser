import "dotenv/config";
import express from "express";
import cors from "cors";
import { parseFolderId } from "./folderId.js";
import { createOAuthClient, GoogleDriveService, saveTokens } from "./driveService.js";
import { SessionManager } from "./sessionManager.js";

const PORT = Number(process.env.PORT ?? 5174);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

let oauthClient = null;
let driveService = null;
let sessionManager = null;

function getOAuthClient() {
  if (!oauthClient) {
    oauthClient = createOAuthClient();
  }
  return oauthClient;
}

function getDriveService() {
  if (!driveService) {
    driveService = new GoogleDriveService({ auth: getOAuthClient() });
  }
  return driveService;
}

function getSessionManager() {
  if (!sessionManager) {
    sessionManager = new SessionManager({ driveService: getDriveService() });
  }
  return sessionManager;
}

app.get("/auth/google/start", (req, res, next) => {
  try {
    const auth = getOAuthClient();
    const url = auth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES
    });
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/google/callback", async (req, res, next) => {
  try {
    const code = req.query.code;
    if (!code) {
      throw new Error("Google did not return an authorization code.");
    }

    const auth = getOAuthClient();
    const { tokens } = await auth.getToken(String(code));
    auth.setCredentials(tokens);
    saveTokens(tokens);
    res.redirect(`${CLIENT_ORIGIN}?signedIn=1`);
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/status", (req, res) => {
  try {
    const auth = getOAuthClient();
    res.json({ signedIn: Boolean(auth.credentials?.access_token || auth.credentials?.refresh_token) });
  } catch {
    res.json({ signedIn: false });
  }
});

app.post("/api/session/start", async (req, res, next) => {
  try {
    const folderId = parseFolderId(req.body.folderIdOrUrl);
    const state = await getSessionManager().start({
      rootFolderId: folderId,
      maxItems: req.body.maxItems ?? 100,
      mediaTypes: req.body.mediaTypes ?? "both"
    });
    res.json(state);
  } catch (error) {
    next(error);
  }
});

app.get("/api/session/state", (req, res, next) => {
  try {
    res.json(getSessionManager().getState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/next", async (req, res, next) => {
  try {
    res.json(await getSessionManager().next());
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/previous", async (req, res, next) => {
  try {
    res.json(await getSessionManager().previous());
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/filter", async (req, res, next) => {
  try {
    res.json(
      await getSessionManager().setFolderIncluded(req.body.folderId, req.body.included)
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/media-types", async (req, res, next) => {
  try {
    res.json(await getSessionManager().setMediaTypes(req.body.mediaTypes));
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/expand", async (req, res, next) => {
  try {
    res.json(await getSessionManager().expandFolder(req.body.folderId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/session/end", (req, res, next) => {
  try {
    res.json(getSessionManager().end());
  } catch (error) {
    next(error);
  }
});

app.get("/api/drive/folders", async (req, res, next) => {
  try {
    const parentId = (req.query.parentId?.toString().trim() || "root");
    const pageToken = req.query.pageToken?.toString();
    const result = await getDriveService().listSubfolders({ parentId, pageToken });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/:fileId", async (req, res, next) => {
  try {
    const manager = getSessionManager();
    const requested = manager.findKnownMedia(req.params.fileId);

    const response = await getDriveService().streamFile({
      fileId: req.params.fileId,
      range: req.headers.range
    });

    res.setHeader("Content-Type", requested?.mimeType ?? "application/octet-stream");
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }
    if (response.headers["content-range"]) {
      res.status(206);
      res.setHeader("Content-Range", response.headers["content-range"]);
    }
    if (response.headers["accept-ranges"]) {
      res.setHeader("Accept-Ranges", response.headers["accept-ranges"]);
    }

    response.data.on("error", next).pipe(res);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  const status = error.code === 401 || error.response?.status === 401 ? 401 : 400;
  res.status(status).json({ error: error.message ?? "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Safe Photo Browser API listening on http://localhost:${PORT}`);
});
