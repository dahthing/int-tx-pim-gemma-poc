import { Injectable } from '@nestjs/common';
import type { IChannelConnector } from '@repo/connector-contracts';
import type { ChannelConnectorResolver, ChannelRef } from '@repo/pim-orders';
import { ConnectorFactory } from './connector-factory';

/** `PIM_ORDERS_TOKENS.CHANNEL_CONNECTOR_RESOLVER`: connector per channel row, credentials decrypted, requests logged. */
@Injectable()
export class ConnectorChannelResolver implements ChannelConnectorResolver {
  constructor(private readonly factory: ConnectorFactory) {}

  resolve(channel: ChannelRef): Promise<IChannelConnector> {
    return this.factory.channel(channel);
  }
}
