/** MQTT 5 properties of a received message. */
export interface MessageProperties {
  contentType?: string;
  responseTopic?: string;
  correlationData?: string;
  messageExpiry?: number;
  payloadFormat?: number;
  userProperties?: [string, string][];
  subscriptionIds?: number[];
}

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
  /** Only present on MQTT 5 connections. */
  properties?: MessageProperties;
}

export type ConnStatus =
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "reconnecting"; error: string }
  | { state: "disconnected" };

export interface Subscription {
  topic: string;
  qos: number;
}

/** 4 = MQTT 3.1.1, 5 = MQTT 5. */
export type Protocol = 4 | 5;

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: Protocol;
  tls: boolean;
  /** Extra CA certificate (PEM) to trust, e.g. a self-signed broker CA. */
  caFile: string;
  clientCertFile: string;
  clientKeyFile: string;
  /** Skip server certificate verification. */
  tlsInsecure: boolean;
  username: string;
  /** Only held in memory; saved passwords live in the system keychain. */
  password: string;
  rememberPassword: boolean;
  clientId: string;
  subscriptions: Subscription[];
}
