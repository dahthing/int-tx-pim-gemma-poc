import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OrderSettings, OrderSettingsProvider } from '@repo/pim-orders';
import { RUNTIME_CONFIG, RUNTIME_DEFAULTS } from '../runtime.constants';

/** Tenant order defaults (phone/email for AW clients, margin floor, VAT) from configuration. */
@Injectable()
export class ConfigOrderSettingsProvider implements OrderSettingsProvider {
  constructor(private readonly config: ConfigService) {}

  async get(_tenantId: string): Promise<OrderSettings> {
    const shipping = this.config.get<string>(
      RUNTIME_CONFIG.ORDER_SHIPPING_ABSORBED,
    );
    return {
      defaultEmail: this.config.getOrThrow<string>(
        RUNTIME_CONFIG.ORDER_DEFAULT_EMAIL,
      ),
      defaultPhone: this.config.getOrThrow<string>(
        RUNTIME_CONFIG.ORDER_DEFAULT_PHONE,
      ),
      minMargin:
        this.config.get<string>(RUNTIME_CONFIG.ORDER_MIN_MARGIN) ??
        RUNTIME_DEFAULTS.ORDER_MIN_MARGIN,
      vatRate:
        this.config.get<string>(RUNTIME_CONFIG.ORDER_VAT_RATE) ??
        RUNTIME_DEFAULTS.ORDER_VAT_RATE,
      ...(shipping && { shippingAbsorbed: shipping }),
    };
  }
}
