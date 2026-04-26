export function parseFolderId(input) {
  if (!input || typeof input !== "string") {
    throw new Error("Enter a Google Drive folder URL or folder ID.");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a Google Drive folder URL or folder ID.");
  }

  if (!trimmed.includes("://")) {
    return trimmed;
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That does not look like a valid Google Drive folder URL.");
  }

  const folderPathMatch = url.pathname.match(/\/folders\/([^/?]+)/);
  if (folderPathMatch) {
    return decodeURIComponent(folderPathMatch[1]);
  }

  const id = url.searchParams.get("id");
  if (id) {
    return id;
  }

  throw new Error("Could not find a folder ID in that Google Drive URL.");
}
