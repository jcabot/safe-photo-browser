import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const TOKEN_PATH = path.resolve("data", "tokens.json");
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_FIELDS =
  "nextPageToken,files(id,name,mimeType,parents,thumbnailLink,webViewLink,size,modifiedTime)";

export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const port = Number(process.env.PORT ?? 5174);
  const redirectUri =
    process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.");
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  if (fs.existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8")));
  }
  client.on("tokens", (tokens) => {
    const merged = { ...client.credentials, ...tokens };
    saveTokens(merged);
  });
  return client;
}

export function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export class GoogleDriveService {
  constructor({ auth }) {
    this.auth = auth;
    this.drive = google.drive({ version: "v3", auth });
  }

  async getFolder(folderId) {
    const response = await this.drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType",
      supportsAllDrives: true
    });

    if (response.data.mimeType !== FOLDER_MIME) {
      throw new Error("The provided Drive ID is not a folder.");
    }

    return response.data;
  }

  async listFolderPage({ folderId, pageToken, pageSize }) {
    const escapedFolderId = folderId.replaceAll("'", "\\'");
    const response = await this.drive.files.list({
      q: `'${escapedFolderId}' in parents and trashed = false and (mimeType = '${FOLDER_MIME}' or mimeType contains 'image/' or mimeType contains 'video/')`,
      fields: DRIVE_FIELDS,
      pageSize,
      pageToken: pageToken ?? undefined,
      orderBy: "folder,name",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    return {
      files: response.data.files ?? [],
      nextPageToken: response.data.nextPageToken ?? null
    };
  }

  async listSubfolders({ parentId, pageToken, pageSize = 100 }) {
    const escaped = parentId.replaceAll("'", "\\'");
    const response = await this.drive.files.list({
      q: `'${escaped}' in parents and trashed = false and mimeType = '${FOLDER_MIME}'`,
      fields: "nextPageToken,files(id,name)",
      pageSize,
      pageToken: pageToken ?? undefined,
      orderBy: "name",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    });

    return {
      files: response.data.files ?? [],
      nextPageToken: response.data.nextPageToken ?? null
    };
  }

  async streamFile({ fileId, range }) {
    return this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      {
        responseType: "stream",
        headers: range ? { Range: range } : undefined
      }
    );
  }
}
