const SEP = '|';

/**
 * ChannelListing only has `lastPayloadHash`; the PS connector also round-trips image checksums,
 * so both are packed into that column as `<hash>|<json checksums>`.
 */
export function encodeListingState(hash: string | undefined, imageChecksums: string[] | undefined): string | null {
  if (!hash) return null;
  return imageChecksums ? `${hash}${SEP}${JSON.stringify(imageChecksums)}` : hash;
}

export function decodeListingState(stored: string | null | undefined): { hash?: string; imageChecksums?: string[] } {
  if (!stored) return { hash: undefined, imageChecksums: undefined };
  const at = stored.indexOf(SEP);
  if (at < 0) return { hash: stored, imageChecksums: undefined };
  const hash = stored.slice(0, at);
  try {
    return { hash, imageChecksums: JSON.parse(stored.slice(at + 1)) as string[] };
  } catch {
    return { hash, imageChecksums: undefined };
  }
}
