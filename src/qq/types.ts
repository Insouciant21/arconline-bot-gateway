export interface QqValidationPayload {
  op: 13;
  d: {
    plain_token: string;
    event_ts: string;
  };
}

export interface QqC2CMessageData {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id?: string;
    user_openid: string;
  };
}

export interface QqDispatchPayload {
  op: 0;
  id?: string;
  t: string;
  s?: number;
  d: Record<string, unknown>;
}

export type QqWebhookPayload = QqValidationPayload | QqDispatchPayload;
