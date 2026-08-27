"use client";

/**
 * Google Drive Picker helpers (client-side only).
 *
 * Requires these env vars:
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID  - web-app OAuth client ID
 *   NEXT_PUBLIC_GOOGLE_API_KEY     - browser API key (Picker enabled)
 *   NEXT_PUBLIC_GOOGLE_APP_ID      - Cloud project number (numeric)
 */
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;

const SCOPE = "https://www.googleapis.com/auth/drive.file";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load " + src)));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}

function isConfigured(): boolean {
  return Boolean(CLIENT_ID && API_KEY && APP_ID);
}

/** Obtain a short-lived Drive access token via Google Identity Services. */
export async function loadTokenClient(): Promise<string> {
  if (!isConfigured()) {
    throw new Error(
      "Google Drive is not configured (missing NEXT_PUBLIC_GOOGLE_CLIENT_ID / API_KEY / APP_ID). You can still import Drive videos by pasting a public share link.",
    );
  }
  await loadScript("https://accounts.google.com/gsi/client");
  const gsi = (window as unknown as { google?: { accounts: { oauth2: { initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (r: { access_token?: string; error?: unknown }) => void;
  }) => { requestAccessToken: (o: { prompt: string }) => void } } } } }).google;
  if (!gsi?.accounts?.oauth2?.initTokenClient) {
    throw new Error("Google Identity Services failed to load");
  }
  return new Promise<string>((resolve, reject) => {
    const client = gsi.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (response) => {
        if (response.error !== undefined || !response.access_token) {
          reject(new Error("Google Drive authorization was cancelled or failed"));
          return;
        }
        resolve(response.access_token);
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

export interface DrivePickResult {
  fileId: string;
  name: string | null;
  mimeType: string | null;
}

/** Open the Google Picker for a video file, returning the picked file. */
export async function loadPicker(token: string): Promise<DrivePickResult | null> {
  await loadScript("https://apis.google.com/js/api.js");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  if (!win.google?.load) throw new Error("Google Picker failed to load");

  await new Promise<void>((resolve) => win.google.load("picker", () => resolve()));

  const gp = win.google?.picker;
  if (!gp) throw new Error("Google Picker is unavailable");

  const view = new gp.View(gp.ViewId.DOCS_VIDEOS);
  view.setMimeTypes("video/mp4,video/webm,video/x-matroska,video/quicktime,video/avi,video/mpeg");

  return new Promise<DrivePickResult | null>((resolve, reject) => {
    const picker = new gp.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY!)
      .setAppId(APP_ID!)
      .setCallback((data: { action?: unknown; docs?: Array<{ id: string; name?: string; mimeType?: string }> }) => {
        if (data.action === gp.Action.CANCEL) {
          resolve(null);
        } else if (data.action === gp.Action.PICKED) {
          const doc = data.docs?.[0];
          if (!doc) {
            resolve(null);
            return;
          }
          resolve({ fileId: doc.id, name: doc.name ?? null, mimeType: doc.mimeType ?? null });
        } else {
          reject(new Error("Google Drive picker returned an error"));
        }
      })
      .build();
    picker.setVisible(true);
  });
}
