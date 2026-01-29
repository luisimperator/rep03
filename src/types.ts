/**
 * Tipos do sistema Eduzz → Loggi Automation
 */

// ===========================================
// Status do Pedido
// ===========================================
export type OrderStatus =
  | 'NOVO'
  | 'ENVIANDO'
  | 'AGUARDANDO_LOGGI'
  | 'ETIQUETA_GERADA'
  | 'FALHA'
  | 'POSTADO';

// ===========================================
// Banco de Dados
// ===========================================
export interface Order {
  id: number;
  invoice_id: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  address_street: string;
  address_number: string;
  address_complement: string | null;
  address_neighborhood: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: string;
  status: OrderStatus;
  loggi_shipment_id: string | null;
  loggi_tracking_code: string | null;
  label_path: string | null;
  error_message: string | null;
  paid_at: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: string;
  product_name: string;
  sku_reference: string | null;
  quantity: number;
  price: number;
}

export interface Event {
  id: number;
  order_id: number | null;
  invoice_id: string | null;
  event_type: string;
  payload: string;
  created_at: string;
}

export interface Job {
  id: number;
  type: string;
  payload: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ===========================================
// Eduzz Webhook Payload
// ===========================================
export interface EduzzWebhookPayload {
  event: string;
  data: {
    id: number | string;
    buyer?: {
      name?: string;
      email?: string;
      phone?: string;
      cellphone?: string;
    };
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
      cellphone?: string;
    };
    address?: EduzzAddress;
    shipping_address?: EduzzAddress;
    items?: EduzzItem[];
    products?: EduzzItem[];
    paid_at?: string;
    payment_date?: string;
    transaction?: {
      id?: string | number;
      key?: string;
    };
  };
}

export interface EduzzAddress {
  street?: string;
  number?: string | number;
  neighborhood?: string;
  complement?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  zip_code?: string;
  cep?: string;
  country?: string;
}

export interface EduzzItem {
  productId?: string | number;
  product_id?: string | number;
  id?: string | number;
  name?: string;
  title?: string;
  skuReference?: string;
  sku_reference?: string;
  sku?: string;
  qty?: number;
  quantity?: number;
  price?: number;
  value?: number;
}

// ===========================================
// Dados Parseados do Webhook Eduzz
// ===========================================
export interface ParsedEduzzData {
  invoiceId: string;
  buyer: {
    name: string;
    email: string;
    phone: string | null;
  };
  address: {
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  items: Array<{
    productId: string;
    name: string;
    skuReference: string | null;
    quantity: number;
    price: number;
  }>;
  paidAt: string;
  transactionId: string | null;
}

// ===========================================
// Loggi API
// ===========================================
export interface LoggiTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoggiShipmentRequest {
  pickupAddress: {
    name: string;
    phone: string;
    email: string;
    address: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  deliveryAddress: {
    name: string;
    phone: string;
    email: string;
    address: {
      street: string;
      number: string;
      complement?: string;
      neighborhood: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  };
  packages: Array<{
    weightG: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  }>;
  externalId?: string;
}

export interface LoggiShipmentResponse {
  id?: string;
  shipmentId?: string;
  trackingCode?: string;
  tracking_code?: string;
  status?: string;
  error?: string;
  message?: string;
}

export interface LoggiWebhookPayload {
  event?: string;
  type?: string;
  data?: {
    shipmentId?: string;
    shipment_id?: string;
    id?: string;
    status?: string;
    trackingCode?: string;
    tracking_code?: string;
  };
}

// ===========================================
// Shipping Provider
// ===========================================
export type ShippingProvider = 'loggi' | 'melhorenvio';

// ===========================================
// Configuração
// ===========================================
export interface Config {
  port: number;
  shippingProvider: ShippingProvider;
  eduzz: {
    webhookSecret: string;
    allowedProductIds: string[];
    allowedSkus: string[];
  };
  loggi: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    companyId: string;
  };
  melhorEnvio: {
    clientId: string;
    token: string;
    sandbox: boolean;
  };
  unnichat: {
    apiUrl: string;
    token: string;
    enabled: boolean;
  };
  origin: {
    name: string;
    phone: string;
    email: string;
    street: string;
    number: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
    zip: string;
    document: string;
    companyDocument: string;
    stateRegister: string;
  };
  package: {
    weightG: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  jobs: {
    pollIntervalMs: number;
    maxRetries: number;
  };
}
