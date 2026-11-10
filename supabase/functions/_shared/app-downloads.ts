// WHAT:       The apps listed on the Settings "Download" tab, and how bridge-builder's answer is turned into
//             the rows the tab shows.
// WHY:        The owner asked (2026-11-10) for the latest TaskOS and Huddle APK links inside each app's Settings,
//             like nexus's extension page. Links in bridge.config.json expire after 30 days and the blob store is
//             private (unsigned URL -> HTTP 409), so a fresh link is fetched from bridge-builder's getLatestApk.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   deventerprisesds/bridge-builder#2; probe runs 42807531417 / 42807535269 (claude_secret-probe).

export interface DownloadApp {
  key: "taskos" | "huddle";
  name: string;
  appId: string; // android-bridge-template configs/<appId>
}

export const DOWNLOAD_APPS: DownloadApp[] = [
  { key: "taskos", name: "TaskOS", appId: "54beaa01-7564-417f-a6cc-bd9190c14dcb" },
  { key: "huddle", name: "Huddle", appId: "8596e6c2-05d5-45c2-9d32-18e03be31471" },
];

export const DEFAULT_BRIDGE_BUILDER_API_URL = "https://bridge-builder-api.azurewebsites.net";

export interface DownloadRow {
  key: string;
  name: string;
  found: boolean;
  version: string | null;
  builtAt: string | null;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

/** Only a signed Azure blob link is ever handed to the page. */
export function isBlobLink(u: unknown): u is string {
  if (typeof u !== "string") return false;
  try {
    const p = new URL(u);
    return p.protocol === "https:" && p.hostname.endsWith(".blob.core.windows.net") && p.search.includes("sig=");
  } catch {
    return false;
  }
}

/** One row per DOWNLOAD_APPS entry, in that order, whatever bridge-builder returned. */
export function shapeDownloads(apps: unknown): DownloadRow[] {
  const list = Array.isArray(apps) ? apps : [];
  return DOWNLOAD_APPS.map((a) => {
    const hit = list.find((x: any) => x && typeof x.appId === "string" && x.appId.toLowerCase() === a.appId) as any;
    const url = hit?.found && isBlobLink(hit.downloadUrl) ? hit.downloadUrl : null;
    return {
      key: a.key,
      name: a.name,
      found: !!url,
      version: url && typeof hit.version === "string" ? hit.version : null,
      builtAt: url && typeof hit.builtAt === "string" ? hit.builtAt : null,
      sizeBytes: url && Number.isFinite(hit.sizeBytes) ? hit.sizeBytes : null,
      downloadUrl: url,
    };
  });
}
