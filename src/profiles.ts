import { invoke } from "@tauri-apps/api/core";
import type { ConnectionProfile, Subscription } from "./types";

const KEY = "tidepool.profiles.v1";

export function newProfile(): ConnectionProfile {
  return {
    id: crypto.randomUUID(),
    name: "New connection",
    host: "",
    port: 1883,
    protocol: 4,
    tls: false,
    caFile: "",
    clientCertFile: "",
    clientKeyFile: "",
    tlsInsecure: false,
    username: "",
    password: "",
    rememberPassword: false,
    clientId: "",
    subscriptions: [
      { topic: "#", qos: 0 },
      { topic: "$SYS/#", qos: 0 },
    ],
  };
}

/** Older profiles stored subscriptions as plain strings. */
function normalizeSubs(raw: unknown): Subscription[] {
  if (!Array.isArray(raw)) return newProfile().subscriptions;
  return raw.map((s) =>
    typeof s === "string" ? { topic: s, qos: 0 } : { topic: String(s?.topic ?? ""), qos: Number(s?.qos ?? 0) },
  );
}

export function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Partial<ConnectionProfile>[];
    return list.map((p) => ({ ...newProfile(), ...p, subscriptions: normalizeSubs(p.subscriptions) }));
  } catch {
    return [];
  }
}

/** Passwords are never written to local storage; see `rememberSecret`. */
export function saveProfiles(list: ConnectionProfile[]): void {
  localStorage.setItem(KEY, JSON.stringify(list.map((p) => ({ ...p, password: "" }))));
}

export const getSecret = (profileId: string) => invoke<string | null>("secret_get", { profileId });
export const deleteSecret = (profileId: string) => invoke<void>("secret_delete", { profileId });

/** Saves or forgets a profile's password in the system keychain. */
export async function rememberSecret(p: ConnectionProfile): Promise<void> {
  if (p.rememberPassword && p.password) {
    await invoke("secret_set", { profileId: p.id, password: p.password });
  } else if (!p.rememberPassword) {
    await deleteSecret(p.id);
  }
}

/**
 * Version 0.1 kept remembered passwords in plain text in local storage.
 * Move any that are still there into the keychain and scrub them.
 * Returns an error message if the keychain couldn't take them.
 */
export async function migratePlaintextPasswords(): Promise<string | undefined> {
  let list: ConnectionProfile[];
  try {
    list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return;
  }
  const withPw = list.filter((p) => p.password);
  if (withPw.length === 0) return;
  let failure: string | undefined;
  for (const p of withPw) {
    try {
      if (p.rememberPassword) await invoke("secret_set", { profileId: p.id, password: p.password });
    } catch (e) {
      failure = String(e);
    }
  }
  // Scrub plain-text copies either way: keeping them is the risk being fixed.
  saveProfiles(list.map((p) => ({ ...p, subscriptions: normalizeSubs(p.subscriptions) })));
  return failure;
}
