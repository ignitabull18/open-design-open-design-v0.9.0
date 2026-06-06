export interface OpsStatusCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  summary: string;
  checkedAt?: string;
}

export interface OpsStatusResponse {
  ok: true;
  generatedAt: string;
  source: 'runtime-file' | 'fallback';
  service: string;
  checks: OpsStatusCheck[];
  rateLimit?: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
  };
  backup?: {
    backupFile?: string;
    offsiteTarget?: string;
    restoreCheck?: string;
    checkedAt?: string;
  };
  monitor?: {
    checkedAt?: string;
    alertTarget?: string;
  };
}
