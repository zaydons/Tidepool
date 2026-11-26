import type { ConnectionProfile } from "./types";

const KEY = "tidepool.profiles.v1";

export function newProfile(): ConnectionProfile {
  return {
    id: crypto.randomUUID(),
    name: "New connection",
    host: "",
    port: 1883,
    tls: false,
    username: "",
    password: "",
    rememberPassword: false,
    clientId: "",
    subscriptions: ["#", "$SYS/#"],
  };
}

export function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ConnectionProfile[];
    return list.map((p) => ({ ...newProfile(), ...p }));
  } catch {
    return [];
  }
}

export function saveProfiles(list: ConnectionProfile[]): void {
  // Passwords are only persisted when the user opts in (stored in plain text
  // in the app's local storage).
  const toStore = list.map((p) => (p.rememberPassword ? p : { ...p, password: "" }));
  localStorage.setItem(KEY, JSON.stringify(toStore));
}
