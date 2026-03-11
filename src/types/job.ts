export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobPayload {
  error?: string;
  [key: string]: unknown;
}

export interface JobResult {
  error?: string;
  [key: string]: unknown;
}

export interface JobResponse<T = unknown> {
  status?: JobStatus;
  result?: T;
  error?: string;
}
