export interface MqttMessage {
  topic: string;
  /** UTF-8 text, or base64 when `binary` is true. */
  payload: string;
  binary: boolean;
  size: number;
  qos: number;
  retain: boolean;
  /** ms since epoch */
  timestamp: number;
}

export type ConnStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "reconnecting"; error: string }
  | { state: "disconnected" };

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  rememberPassword: boolean;
  clientId: string;
  subscriptions: string[];
}
