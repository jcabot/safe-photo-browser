# safe-photo-browser

Web app that accepts a Google Drive folder ID, crawls that folder and all subfolders, and randomly displays one image or video from the discovered files.

## Features

- Recursively walks a Google Drive folder tree, including shortcuts.
- Randomly chooses images and videos only.
- Supports public folders with an API key.
- Supports private/shared folders after Google sign-in.
- Shows metadata, lets you reshuffle, and can open the file in Google Drive.

## Requirements

You need a Google Cloud project with:

1. **Google Drive API** enabled.
2. An **API key** for Drive file listing requests.
3. An **OAuth client ID** for Google sign-in in the browser.

For private folders, the signed-in Google account must have access to the folder.  
For public folders, an API key is usually enough.

## Setup

1. Create a `.env` file in the project root:

   ```bash
   GOOGLE_API_KEY=your_api_key
   GOOGLE_CLIENT_ID=your_oauth_client_id
   PORT=3000
   ```

2. Install nothing extra; the app uses only Node's built-in modules.
3. Start the server:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000`.

## Usage

1. Paste a Google Drive folder ID or full folder URL.
2. If the folder is private or shared, click **Sign in with Google**.
3. Click **Load media**.
4. Click **Show another random item** to reshuffle.

## Notes

- The browser displays Drive-hosted media using the `uc?export=view&id=...` endpoint.
- Some video formats may be restricted by the browser even if Drive stores them.
- Very large folder trees may take a while because the app paginates through Drive results.
- Shared drives are supported for listing requests.
