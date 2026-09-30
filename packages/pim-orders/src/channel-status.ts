import { CHANNEL_CODES, CHANNEL_STATUS_DEFAULTS, CHANNEL_STATUS_SETTINGS } from './constants';
import { asRecord } from './json';

export type ChannelStatusKind = 'cancelled' | 'delivered' | 'open';

export interface ChannelStatusSets {
  cancelled: Set<string>;
  delivered: Set<string>;
}

const norm = (v: unknown): string => String(v).trim().toLowerCase();

function configured(settings: Record<string, unknown>, key: string, fallback: readonly string[]): Set<string> {
  const v = settings[key];
  const list = Array.isArray(v) ? v : fallback;
  return new Set(list.map(norm));
}

/** Effective cancelled / delivered external statuses of a channel (defaults, overridable in `Channel.settings`). */
export function channelStatusSets(channelCode: string, settings: unknown): ChannelStatusSets {
  const s = asRecord(settings);
  const defaults =
    channelCode === CHANNEL_CODES.PRESTASHOP9
      ? CHANNEL_STATUS_DEFAULTS.PRESTASHOP9
      : channelCode === CHANNEL_CODES.TEMU_EU
        ? CHANNEL_STATUS_DEFAULTS.TEMU_EU
        : { cancelled: [], delivered: [] };
  return {
    cancelled: configured(s, CHANNEL_STATUS_SETTINGS.CANCELLED, defaults.cancelled),
    delivered: configured(s, CHANNEL_STATUS_SETTINGS.DELIVERED, defaults.delivered),
  };
}

/** FR-ORD-001 AC2 / FR-TEMU-004 AC2: is the channel's external status a cancellation or a delivery? */
export function classifyChannelStatus(channelCode: string, settings: unknown, externalStatus: string | null | undefined): ChannelStatusKind {
  if (externalStatus === null || externalStatus === undefined) return 'open';
  const sets = channelStatusSets(channelCode, settings);
  const s = norm(externalStatus);
  if (sets.cancelled.has(s)) return 'cancelled';
  if (sets.delivered.has(s)) return 'delivered';
  return 'open';
}
