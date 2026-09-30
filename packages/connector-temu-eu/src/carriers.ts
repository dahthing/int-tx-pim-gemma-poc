import { DomainError } from '@repo/core-domain';

export interface TemuCarrier {
  temuCarrierId: string;
  temuCarrierName: string;
}
/** Maintained in settings: our carrier code (lower-case) -> Temu carrier. */
export type CarrierTable = Record<string, TemuCarrier>;

export class UnknownCarrierError extends DomainError {
  constructor(carrierCode: string) {
    super('UNKNOWN_CARRIER', `No Temu carrier mapped for carrier code "${carrierCode}"; shipment push blocked`, { carrierCode });
    this.name = 'UnknownCarrierError';
    Object.setPrototypeOf(this, UnknownCarrierError.prototype);
  }
}

export function resolveCarrier(table: CarrierTable, carrierCode: string): TemuCarrier {
  const key = carrierCode.trim().toLowerCase();
  const hit = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  if (!hit) throw new UnknownCarrierError(carrierCode);
  return hit;
}
