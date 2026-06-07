export interface OpsStatusCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  summary: string;
  checkedAt?: string;
}

export interface OpsStatusCategory {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  summary: string;
  checks: OpsStatusCheck[];
}

export interface OpsEvidenceArtifact {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  summary: string;
  path?: string;
  url?: string;
  generatedAt?: string;
}

export interface OpsStatusResponse {
  ok: true;
  generatedAt: string;
  source: 'runtime-file' | 'fallback';
  service: string;
  checks: OpsStatusCheck[];
  categories?: OpsStatusCategory[];
  evidence?: {
    artifacts: OpsEvidenceArtifact[];
    bundlePath?: string;
    generatedAt?: string;
  };
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
  deployment?: {
    baseUrl?: string;
    tunnelTarget?: string;
    expectedTunnelTarget?: string;
    coolifyAppUuid?: string;
    deploymentUuid?: string;
    commit?: string;
    driftChecks?: OpsStatusCheck[];
  };
  restore?: {
    manifestPath?: string;
    backupFile?: string;
    offsiteTarget?: string;
    restoreCheck?: string;
    checkedAt?: string;
  };
  release?: {
    channel?: string;
    version?: string;
    tag?: string;
    promotedAt?: string;
    checklist?: OpsStatusCheck[];
  };
}
