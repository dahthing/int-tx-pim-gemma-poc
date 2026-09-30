/** Ports that the host application (or other packages) must implement. */

export interface ListingStockZeroer {
  /** Sets the stock of every listing of the given products to 0 on all channels. */
  zeroStock(tenantId: string, productIds: string[]): Promise<void>;
}

export interface ChannelSyncEnqueuer {
  /** Enqueues channel price/stock updates for the changed products only. */
  enqueueProductUpdates(tenantId: string, productIds: string[]): Promise<void>;
}

export interface AlertInput {
  tenantId: string;
  type: string;
  message: string;
  productId?: string;
  channelId?: string;
  details?: Record<string, unknown>;
}

export interface AlertService {
  raise(alert: AlertInput): Promise<void>;
}

export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Public URL served to channels. */
  publicUrl(key: string): string;
}

export interface DownloadedMedia {
  data: Buffer;
  mime: string;
}

export interface MediaDownloader {
  download(url: string): Promise<DownloadedMedia>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
}

export interface LlmRequest {
  system: string;
  user: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmUsageEntry extends LlmUsage {
  tenantId: string;
  productId: string;
  operation: string;
}

export interface UsageLogger {
  logLlmUsage(entry: LlmUsageEntry): Promise<void>;
}
