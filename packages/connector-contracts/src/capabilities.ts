export interface ConnectorCapabilities {
  catalogRead?: boolean;
  assortmentWrite?: boolean;
  stockRead?: boolean;
  costRead?: boolean;
  mediaRead?: boolean;
  dropshipOrderWrite?: boolean;
  trackingRead?: boolean;
  listingWrite?: boolean;
  stockWrite?: boolean;
  priceWrite?: boolean;
  orderRead?: boolean;
  shipmentWrite?: boolean;
  categoryTreeRead?: boolean;
}
