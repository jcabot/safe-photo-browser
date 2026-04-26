const DRIVE_DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";
const DEFAULT_STATUS = "Enter a Google Drive folder ID or URL, then load media.";
const PUBLIC_PREVIEW_IFRAME_ORIGIN = "https://drive.google.com";

const config = window.APP_CONFIG || {};

const state = {
  tokenClient: null,
  accessToken: "",
  gapiReady: false,
  gisReady: false,
  loading: false,
  mediaItems: [],
  lastSelectedIndex: -1,
  currentPreviewObjectUrl: "",
};

const elements = {
  folderForm: document.querySelector("#folderForm"),
  folderInput: document.querySelector("#folderInput"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  authStatus: document.querySelector("#authStatus"),
  loadButton: document.querySelector("#loadButton"),
  randomButton: document.querySelector("#randomButton"),
  useAuthCheckbox: document.querySelector("#useAuthCheckbox"),
  includeImagesCheckbox: document.querySelector("#includeImagesCheckbox"),
  includeVideosCheckbox: document.querySelector("#includeVideosCheckbox"),
  status: document.querySelector("#status"),
  count: document.querySelector("#count"),
  currentName: document.querySelector("#currentName"),
  currentPath: document.querySelector("#currentPath"),
  currentMeta: document.querySelector("#currentMeta"),
  emptyState: document.querySelector("#emptyState"),
  mediaFrame: document.querySelector("#mediaFrame"),
  imageViewer: document.querySelector("#imageViewer"),
  videoViewer: document.querySelector("#videoViewer"),
  videoFrame: document.querySelector("#videoFrame"),
  openDriveLink: document.querySelector("#openDriveLink"),
};

initialize();

function initialize() {
  setStatus(DEFAULT_STATUS);
  updateCount(0);
  clearViewer();
  updateAuthButtons();
  updateControls();

  elements.folderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void loadFolder();
  });

  elements.randomButton.addEventListener("click", () => {
    void showRandomItem();
  });

  elements.signInButton.addEventListener("click", () => {
    void signIn();
  });

  elements.signOutButton.addEventListener("click", signOut);
  elements.useAuthCheckbox.addEventListener("change", updateControls);

  loadGoogleApis();
}

async function loadGoogleApis() {
  try {
    await loadScript("https://apis.google.com/js/api.js");
    await new Promise((resolve) => {
      window.gapi.load("client", resolve);
    });
    await window.gapi.client.init({
      apiKey: config.googleApiKey || "",
      discoveryDocs: [DRIVE_DISCOVERY_DOC],
    });
    state.gapiReady = true;

    if (config.googleClientId) {
      await loadScript("https://accounts.google.com/gsi/client");
      state.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.googleClientId,
        scope: DRIVE_SCOPE,
        callback: () => {},
      });
      state.gisReady = true;
    }

    setStatus(DEFAULT_STATUS);
  } catch (error) {
    setStatus(`Unable to initialize Google APIs: ${formatError(error)}`, true);
  } finally {
    updateAuthButtons();
    updateControls();
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

async function signIn() {
  if (!config.googleClientId) {
    setStatus("Set GOOGLE_CLIENT_ID in .env before signing in.", true);
    return;
  }

  if (!state.gisReady || !state.tokenClient) {
    setStatus("Google Sign-In is still loading. Try again in a moment.", true);
    return;
  }

  try {
    const tokenResponse = await new Promise((resolve, reject) => {
      state.tokenClient.callback = (response) => {
        if (response.error) {
          reject(response);
          return;
        }
        resolve(response);
      };

      state.tokenClient.requestAccessToken({
        prompt: state.accessToken ? "" : "consent",
      });
    });

    state.accessToken = tokenResponse.access_token;
    elements.useAuthCheckbox.checked = true;
    applyActiveToken();
    setStatus("Signed in. You can now load private or shared folders.", false);
  } catch (error) {
    setStatus(`Sign-in failed: ${formatError(error)}`, true);
  } finally {
    updateAuthButtons();
    updateControls();
  }
}

function signOut() {
  if (state.accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(state.accessToken, () => {});
  }

  state.accessToken = "";
  elements.useAuthCheckbox.checked = false;
  applyActiveToken();
  revokePreviewObjectUrl();
  updateAuthButtons();
  updateControls();
  setStatus("Signed out. Public folders can still be loaded with an API key.", false);
}

async function loadFolder() {
  if (!state.gapiReady) {
    setStatus("Google API client is still loading. Try again in a moment.", true);
    return;
  }

  const folderId = extractFolderId(elements.folderInput.value);
  if (!folderId) {
    setStatus("Enter a valid Google Drive folder ID or folder URL.", true);
    return;
  }

  if (!config.googleApiKey) {
    setStatus("Set GOOGLE_API_KEY in .env before loading a folder.", true);
    return;
  }

  const includeImages = elements.includeImagesCheckbox.checked;
  const includeVideos = elements.includeVideosCheckbox.checked;
  if (!includeImages && !includeVideos) {
    setStatus("Select at least one media type.", true);
    return;
  }

  if (elements.useAuthCheckbox.checked && !state.accessToken) {
    setStatus("Sign in first, or turn off Google sign-in for public folders.", true);
    return;
  }

  state.loading = true;
  state.mediaItems = [];
  state.lastSelectedIndex = -1;
  clearViewer();
  updateCount(0);
  updateControls();
  applyActiveToken();
  setStatus("Scanning the Drive folder and its subfolders...", false);

  try {
    const folderName = await verifyFolder(folderId);
    const allItems = await collectMedia(folderId, folderName, {
      includeImages,
      includeVideos,
    });

    state.mediaItems = allItems;
    updateCount(allItems.length);

    if (!allItems.length) {
      setStatus("No matching images or videos were found in that folder tree.", true);
      return;
    }

    setStatus(`Loaded ${allItems.length} media item${allItems.length === 1 ? "" : "s"}.`, false);
    await showRandomItem();
  } catch (error) {
    setStatus(buildDriveErrorMessage(error), true);
  } finally {
    state.loading = false;
    updateControls();
  }
}

async function verifyFolder(folderId) {
  const response = await window.gapi.client.drive.files.get({
    fileId: folderId,
    fields: "id, name, mimeType",
    supportsAllDrives: true,
  });
  const folder = response.result;

  if (folder.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error("The provided ID does not point to a Google Drive folder.");
  }

  return folder.name;
}

async function collectMedia(rootFolderId, rootFolderName, options) {
  const queue = [{ id: rootFolderId, path: rootFolderName }];
  const visitedFolders = new Set();
  const mediaItems = [];

  while (queue.length > 0) {
    const currentFolder = queue.shift();
    if (visitedFolders.has(currentFolder.id)) {
      continue;
    }
    visitedFolders.add(currentFolder.id);

    let pageToken = "";
    do {
      const response = await window.gapi.client.drive.files.list({
        q: `'${currentFolder.id}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, webViewLink, shortcutDetails(targetId, targetMimeType))",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        orderBy: "folder,name_natural",
        pageSize: 1000,
        pageToken,
      });

      for (const file of response.result.files || []) {
        if (file.mimeType === FOLDER_MIME_TYPE) {
          queue.push({
            id: file.id,
            path: `${currentFolder.path}/${file.name}`,
          });
          continue;
        }

        if (file.mimeType === SHORTCUT_MIME_TYPE) {
          const targetId = file.shortcutDetails?.targetId;
          const targetMimeType = file.shortcutDetails?.targetMimeType;

          if (!targetId || !targetMimeType) {
            continue;
          }

          if (targetMimeType === FOLDER_MIME_TYPE) {
            queue.push({
              id: targetId,
              path: `${currentFolder.path}/${file.name}`,
            });
            continue;
          }

          if (isSupportedMimeType(targetMimeType, options)) {
            mediaItems.push(
              createMediaItem(
                {
                  id: targetId,
                  name: file.name,
                  mimeType: targetMimeType,
                  webViewLink: file.webViewLink,
                },
                currentFolder.path,
              ),
            );
          }
          continue;
        }

        if (isSupportedMimeType(file.mimeType, options)) {
          mediaItems.push(createMediaItem(file, currentFolder.path));
        }
      }

      pageToken = response.result.nextPageToken || "";
    } while (pageToken);
  }

  return mediaItems;
}

function createMediaItem(file, pathLabel) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    previewUrl: `https://drive.google.com/thumbnail?id=${file.id}&sz=w2000`,
    pathLabel,
  };
}

function isSupportedMimeType(mimeType, options) {
  if (!mimeType) {
    return false;
  }

  if (mimeType.startsWith("image/")) {
    return options.includeImages;
  }

  if (mimeType.startsWith("video/")) {
    return options.includeVideos;
  }

  return false;
}

async function showRandomItem() {
  if (!state.mediaItems.length) {
    setStatus("Load a folder with at least one supported image or video first.", true);
    return;
  }

  let index = Math.floor(Math.random() * state.mediaItems.length);
  if (state.mediaItems.length > 1 && index === state.lastSelectedIndex) {
    index = (index + 1) % state.mediaItems.length;
  }
  state.lastSelectedIndex = index;

  const item = state.mediaItems[index];
  const isVideo = item.mimeType.startsWith("video/");

  revokePreviewObjectUrl();
  elements.currentName.textContent = item.name;
  elements.currentPath.textContent = item.pathLabel;
  elements.currentMeta.textContent = item.mimeType;
  elements.openDriveLink.href = item.webViewLink;
  elements.openDriveLink.hidden = false;
  elements.emptyState.hidden = true;
  elements.mediaFrame.hidden = false;

  if (elements.useAuthCheckbox.checked && state.accessToken) {
    await renderAuthenticatedPreview(item);
  } else if (isVideo) {
    renderPublicVideo(item);
  } else {
    renderPublicImage(item);
  }

  setStatus(`Showing a random ${isVideo ? "video" : "image"} from the loaded folder tree.`, false);
}

async function renderAuthenticatedPreview(item) {
  const blob = await fetchMediaBlob(item.id);
  state.currentPreviewObjectUrl = URL.createObjectURL(blob);

  if (item.mimeType.startsWith("video/")) {
    elements.imageViewer.hidden = true;
    elements.imageViewer.removeAttribute("src");
    elements.videoViewer.hidden = false;
    elements.videoFrame.hidden = true;
    elements.videoFrame.removeAttribute("src");
    elements.videoViewer.src = state.currentPreviewObjectUrl;
    return;
  }

  elements.videoViewer.hidden = true;
  elements.videoViewer.removeAttribute("src");
  elements.videoFrame.hidden = true;
  elements.videoFrame.removeAttribute("src");
  elements.imageViewer.hidden = false;
  elements.imageViewer.src = state.currentPreviewObjectUrl;
  elements.imageViewer.alt = item.name;
}

function renderPublicImage(item) {
  elements.videoFrame.hidden = true;
  elements.videoFrame.removeAttribute("src");
  elements.videoViewer.hidden = true;
  elements.videoViewer.removeAttribute("src");
  elements.imageViewer.hidden = false;
  elements.imageViewer.src = item.previewUrl;
  elements.imageViewer.alt = item.name;
}

function renderPublicVideo(item) {
  elements.imageViewer.hidden = true;
  elements.imageViewer.removeAttribute("src");
  elements.videoViewer.hidden = true;
  elements.videoViewer.removeAttribute("src");
  elements.videoFrame.hidden = false;
  elements.videoFrame.src = `${PUBLIC_PREVIEW_IFRAME_ORIGIN}/file/d/${item.id}/preview`;
}

async function fetchMediaBlob(fileId) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${state.accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Preview request failed with status ${response.status}`);
  }

  return response.blob();
}

function clearViewer() {
  revokePreviewObjectUrl();
  elements.currentName.textContent = "Nothing selected yet";
  elements.currentPath.textContent = "";
  elements.currentMeta.textContent = "";
  elements.openDriveLink.hidden = true;
  elements.mediaFrame.hidden = true;
  elements.imageViewer.hidden = true;
  elements.imageViewer.removeAttribute("src");
  elements.videoViewer.hidden = true;
  elements.videoViewer.removeAttribute("src");
  elements.videoFrame.hidden = true;
  elements.videoFrame.removeAttribute("src");
  elements.emptyState.hidden = false;
}

function revokePreviewObjectUrl() {
  if (state.currentPreviewObjectUrl) {
    URL.revokeObjectURL(state.currentPreviewObjectUrl);
    state.currentPreviewObjectUrl = "";
  }
}

function applyActiveToken() {
  if (elements.useAuthCheckbox.checked && state.accessToken) {
    window.gapi?.client?.setToken?.({ access_token: state.accessToken });
    return;
  }

  window.gapi?.client?.setToken?.(null);
}

function updateControls() {
  const canSignIn = Boolean(config.googleClientId) && state.gisReady && !state.accessToken;
  const canLoad = state.gapiReady && !state.loading;
  const canRandomize = !state.loading && state.mediaItems.length > 0;

  elements.signInButton.disabled = !canSignIn;
  elements.signOutButton.disabled = !state.accessToken;
  elements.loadButton.disabled = !canLoad;
  elements.randomButton.disabled = !canRandomize;
  elements.useAuthCheckbox.disabled = !config.googleClientId || !state.accessToken;
}

function updateAuthButtons() {
  elements.signInButton.hidden = Boolean(state.accessToken);
  elements.signOutButton.hidden = !state.accessToken;
  elements.authStatus.textContent = state.accessToken
    ? "Signed in. Private and shared folders are available."
    : config.googleClientId
      ? "Not signed in. Public folders can still work with the API key."
      : "OAuth is not configured. Public folders can still work with the API key.";
}

function updateCount(count) {
  elements.count.textContent = `${count} item${count === 1 ? "" : "s"} loaded`;
}

function extractFolderId(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  const idMatch = trimmed.match(/^[a-zA-Z0-9_-]{10,}$/);
  return idMatch ? idMatch[0] : "";
}

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.dataset.tone = isError ? "error" : "normal";
}

function buildDriveErrorMessage(error) {
  const message = formatError(error);

  if (message.includes("Login Required") || message.includes("invalid_token")) {
    return "Google Drive says you need to sign in before reading this folder.";
  }

  if (message.includes("The API developer key is invalid")) {
    return "The Google API key is invalid. Update GOOGLE_API_KEY in .env.";
  }

  if (message.includes("File not found")) {
    return "Folder not found. Check the Drive folder URL/ID and confirm you have access.";
  }

  if (message.includes("insufficient permissions") || message.includes("403")) {
    return "Access denied. For private folders, sign in with an account that can read the folder.";
  }

  return `Unable to load the folder: ${message}`;
}

function formatError(error) {
  return (
    error?.result?.error?.message ||
    error?.details ||
    error?.message ||
    error?.error ||
    "Unknown error"
  );
}
