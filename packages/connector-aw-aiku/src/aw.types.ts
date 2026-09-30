/** Raw AW/Aiku payload shapes. Fields marked ASSUMED are isolated in fixtures, see docs/spikes/aw-aiku-assumptions.md. */
export interface AwNamed {
  name?: string | null;
}

export interface AwProduct {
  id: number | string;
  code: string;
  slug?: string;
  ean_barcode?: string | null;
  name: string;
  description?: string | null;
  description_extra?: string | null;
  price: string | number;
  currency_code: string;
  current_stock: number;
  gross_weight?: number | null;
  image?: { original?: string | null; original_2x?: string | null } | null;
  department?: AwNamed | null;
  sub_department?: AwNamed | null;
  family?: AwNamed | null;
  department_name?: string | null;
  sub_department_name?: string | null;
  family_name?: string | null;
  [k: string]: unknown;
}

export interface AwPortfolioItem {
  id: number | string;
  item_id?: number | string | null;
  code: string;
  quantity_left?: number;
  weight?: number | null;
  price?: string | number;
  selling_price?: string | number | null;
  state?: string;
  status?: string;
}

export interface AwImage {
  uuid: string;
  name: string;
  mime_type: string;
  source?: { original?: string | null } | null;
}

export interface AwTransaction {
  id: number | string;
  quantity_ordered?: number;
  quantity_dispatched?: number;
  quantity_fail?: number;
  quantity_cancelled?: number;
}

export interface AwLaravelPage<T> {
  data?: T[];
  links?: { next?: string | null };
  meta?: { current_page?: number; last_page?: number };
}
