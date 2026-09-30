import { CATEGORY_PATH_SEPARATOR } from '../constants';

export function stripHtml(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSegment(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedKey(department?: string | null, sub?: string | null, family?: string | null): string {
  return [department, sub, family].map(normalizeSegment).join(CATEGORY_PATH_SEPARATOR);
}
