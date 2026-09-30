import { Injectable } from '@nestjs/common';
import type {
  ListingSyncInput,
  ListingSyncInputProvider,
} from '@repo/pim-orders';
import { PricingInputBuilder } from './pricing-input.builder';

@Injectable()
export class ListingSyncInputProviderImpl implements ListingSyncInputProvider {
  constructor(private readonly pricing: PricingInputBuilder) {}

  async getInputs(
    tenantId: string,
    channelId: string,
    productIds: string[],
  ): Promise<ListingSyncInput[]> {
    const contexts = await this.pricing.buildMany(
      tenantId,
      channelId,
      productIds,
    );
    return contexts.map(({ productId, price, stock }) => ({
      productId,
      price,
      stock,
    }));
  }
}
