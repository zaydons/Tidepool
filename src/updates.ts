import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";

const RELEASES_API = "https://api.github.com/repos/zaydons/Tidepool/releases/latest";
export const RELEASES_PAGE = "https://github.com/zaydons/Tidepool/releases/latest";
const RECHECK_MS = 6 * 60 * 60 * 1000;

/** How this install can update (see `install_kind` in src-tauri/src/lib.rs). */
type InstallKind = "macos" | "windows" | "appimage" | "linux-package" | "other";

export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  /** `inApp`: can download and install itself; otherwise the user downloads it. */
  | { status: "available"; version: string; inApp: boolean }
  | { status: "downloading"; version: string; percent: number | null }
  | { status: "error"; message: string };

/** Compare dotted numeric versions ("0.10.1" > "0.9.3"). Ignores pre-release tags. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export function useUpdates() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const [currentVersion, setCurrentVersion] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  /** `manual`: user clicked "Check for updates", so report "up to date" and errors. */
  const checkNow = useCallback(async (manual = false) => {
    if (busy.current) return;
    busy.current = true;
    if (manual) setState({ status: "checking" });
    try {
      const kind = await invoke<InstallKind>("install_kind");
      if (kind === "linux-package" || kind === "other") {
        // .deb/.rpm installs belong to the package manager: just tell the user.
        const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
        const latest = ((await res.json()) as { tag_name: string }).tag_name.replace(/^v/, "");
        const current = await getVersion();
        if (isNewer(latest, current)) {
          setState({ status: "available", version: latest, inApp: false });
        } else if (manual) {
          setState({ status: "up-to-date" });
        } else {
          setState({ status: "idle" });
        }
      } else {
        const update = await check();
        updateRef.current = update;
        if (update) {
          setState({ status: "available", version: update.version, inApp: true });
        } else if (manual) {
          setState({ status: "up-to-date" });
        } else {
          setState({ status: "idle" });
        }
      }
    } catch (err) {
      // Background checks fail quietly (offline, no release published yet...).
      setState(manual ? { status: "error", message: String(err) } : { status: "idle" });
    } finally {
      busy.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    if (state.status !== "available") return;
    if (!state.inApp || !updateRef.current) {
      await openUrl(RELEASES_PAGE);
      return;
    }
    const version = state.version;
    let total = 0;
    let received = 0;
    setState({ status: "downloading", version, percent: null });
    try {
      await updateRef.current.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          setState({
            status: "downloading",
            version,
            percent: total ? Math.min(100, Math.round((received / total) * 100)) : null,
          });
        }
      });
      await relaunch();
    } catch (err) {
      setState({ status: "error", message: `Update failed: ${err}` });
    }
  }, [state]);

  // Check shortly after launch, then every few hours while the app is open.
  useEffect(() => {
    const first = setTimeout(() => checkNow(false), 3000);
    const every = setInterval(() => checkNow(false), RECHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkNow]);

  const dismiss = useCallback(() => {
    if (state.status === "available") setDismissed(state.version);
    else setState({ status: "idle" });
  }, [state]);

  const visible =
    state.status === "downloading" ||
    state.status === "error" ||
    state.status === "up-to-date" ||
    state.status === "checking" ||
    (state.status === "available" && dismissed !== state.version);

  return { state, currentVersion, checkNow, install, dismiss, visible };
}

export type Updates = ReturnType<typeof useUpdates>;
