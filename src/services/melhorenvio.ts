/**
 * Serviço de integração com Melhor Envio
 * https://docs.melhorenvio.com.br/
 */

import { config } from '../config.js';
import { logger, createOrderLogger } from '../utils/logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Order } from '../types.js';

const MELHOR_ENVIO_API = 'https://melhorenvio.com.br/api/v2';
const MELHOR_ENVIO_SANDBOX = 'https://sandbox.melhorenvio.com.br/api/v2';

// Usar produção ou sandbox baseado em config
function getBaseUrl(): string {
  return config.melhorEnvio.sandbox ? MELHOR_ENVIO_SANDBOX : MELHOR_ENVIO_API;
}

/**
 * Headers padrão para requisições
 */
function getHeaders(): Record<string, string> {
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.melhorEnvio.token}`,
    'User-Agent': 'EduzzAutomacao/1.0',
  };
}

/**
 * Erro da API Melhor Envio
 */
export class MelhorEnvioError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'MelhorEnvioError';
  }

  isTransient(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

/**
 * Faz requisição para a API do Melhor Envio
 */
async function melhorEnvioRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${getBaseUrl()}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...getHeaders(),
      ...options.headers,
    },
  });

  const text = await response.text();
  let data: T;

  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new MelhorEnvioError(response.status, `Resposta inválida: ${text}`);
  }

  if (!response.ok) {
    const errorData = data as { message?: string; error?: string; errors?: Record<string, string[]> };
    const message = errorData.message || errorData.error || JSON.stringify(errorData.errors) || text;
    throw new MelhorEnvioError(response.status, message, errorData);
  }

  return data;
}

/**
 * Calcula frete para um pedido
 */
export async function calcularFrete(order: Order): Promise<{
  id: number;
  name: string;
  price: number;
  delivery_time: number;
  company: { name: string };
}[]> {
  const log = createOrderLogger(order.invoice_id);
  log.info('Calculando frete no Melhor Envio');

  const payload = {
    from: {
      postal_code: config.origin.zip,
    },
    to: {
      postal_code: order.address_zip,
    },
    products: [
      {
        id: order.invoice_id,
        width: config.package.widthCm,
        height: config.package.heightCm,
        length: config.package.lengthCm,
        weight: config.package.weightG / 1000, // Converter para KG
        insurance_value: 0,
        quantity: 1,
      },
    ],
  };

  const result = await melhorEnvioRequest<Array<{
    id: number;
    name: string;
    price: string;
    delivery_time: number;
    error?: string;
    company: { name: string };
  }>>('/me/shipment/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  // Filtrar serviços com erro e converter preço
  const servicos = result
    .filter(s => !s.error)
    .map(s => ({
      ...s,
      price: parseFloat(s.price),
    }));

  log.info({ servicos: servicos.length }, 'Cotação recebida');
  return servicos;
}

/**
 * Adiciona pacote ao carrinho do Melhor Envio
 */
export async function adicionarAoCarrinho(
  order: Order,
  serviceId: number
): Promise<{ id: string }> {
  const log = createOrderLogger(order.invoice_id);
  log.info({ serviceId }, 'Adicionando ao carrinho do Melhor Envio');

  const payload = {
    service: serviceId,
    agency: null, // Coleta no endereço
    from: {
      name: config.origin.name,
      phone: config.origin.phone,
      email: config.origin.email,
      document: config.origin.document || undefined,
      company_document: config.origin.companyDocument || undefined,
      state_register: config.origin.stateRegister || undefined,
      address: config.origin.street,
      complement: config.origin.complement || undefined,
      number: config.origin.number,
      district: config.origin.neighborhood,
      city: config.origin.city,
      state_abbr: config.origin.state,
      country_id: 'BR',
      postal_code: config.origin.zip,
    },
    to: {
      name: order.buyer_name,
      phone: order.buyer_phone || config.origin.phone,
      email: order.buyer_email,
      address: order.address_street,
      complement: order.address_complement || undefined,
      number: order.address_number,
      district: order.address_neighborhood,
      city: order.address_city,
      state_abbr: order.address_state,
      country_id: 'BR',
      postal_code: order.address_zip,
    },
    products: [
      {
        name: 'Adesivos',
        quantity: 1,
        unitary_value: 1,
      },
    ],
    volumes: [
      {
        height: config.package.heightCm,
        width: config.package.widthCm,
        length: config.package.lengthCm,
        weight: config.package.weightG / 1000,
      },
    ],
    options: {
      insurance_value: 0,
      receipt: false,
      own_hand: false,
      collect: false, // Postagem em agência
      reverse: false,
      non_commercial: true,
      invoice: {
        key: order.invoice_id,
      },
    },
  };

  const result = await melhorEnvioRequest<{ id: string }>('/me/cart', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  log.info({ cartId: result.id }, 'Adicionado ao carrinho');
  return result;
}

/**
 * Efetua a compra/checkout do carrinho
 */
export async function checkout(cartIds: string[]): Promise<{
  purchase: { id: string; status: string };
  orders: Array<{ id: string; tracking?: string }>;
}> {
  logger.info({ cartIds }, 'Efetuando checkout no Melhor Envio');

  const payload = {
    orders: cartIds,
  };

  const result = await melhorEnvioRequest<{
    purchase: { id: string; status: string };
    orders?: Array<{ id: string; tracking?: string }>;
  }>('/me/shipment/checkout', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return {
    purchase: result.purchase,
    orders: result.orders || [],
  };
}

/**
 * Gera etiqueta para um pedido
 */
export async function gerarEtiqueta(orderId: string): Promise<void> {
  logger.info({ orderId }, 'Gerando etiqueta no Melhor Envio');

  await melhorEnvioRequest('/me/shipment/generate', {
    method: 'POST',
    body: JSON.stringify({ orders: [orderId] }),
  });
}

/**
 * Imprime/baixa etiqueta em PDF
 */
export async function imprimirEtiqueta(
  orderId: string,
  invoiceId: string
): Promise<string> {
  const log = createOrderLogger(invoiceId);
  log.info({ orderId }, 'Baixando etiqueta PDF');

  const result = await melhorEnvioRequest<{ url?: string }>('/me/shipment/print', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'private',
      orders: [orderId]
    }),
  });

  if (!result.url) {
    throw new MelhorEnvioError(500, 'URL da etiqueta não retornada');
  }

  // Baixar o PDF
  const pdfResponse = await fetch(result.url, {
    headers: getHeaders(),
  });

  if (!pdfResponse.ok) {
    throw new MelhorEnvioError(pdfResponse.status, 'Erro ao baixar PDF da etiqueta');
  }

  const buffer = await pdfResponse.arrayBuffer();
  const labelPath = saveLabelFile(invoiceId, Buffer.from(buffer));

  log.info({ labelPath }, 'Etiqueta salva');
  return labelPath;
}

/**
 * Consulta informações de um pedido/envio
 */
export async function consultarEnvio(orderId: string): Promise<{
  id: string;
  status: string;
  tracking?: string;
}> {
  const result = await melhorEnvioRequest<{
    id: string;
    status: string;
    tracking?: string;
  }>(`/me/orders/${orderId}`, {
    method: 'GET',
  });

  return result;
}

/**
 * Consulta rastreamento
 */
export async function rastrear(tracking: string): Promise<{
  events: Array<{
    date: string;
    time: string;
    description: string;
    location?: string;
  }>;
}> {
  const result = await melhorEnvioRequest<{
    [key: string]: {
      events?: Array<{
        date: string;
        time: string;
        description: string;
        location?: string;
      }>;
    };
  }>(`/me/shipment/tracking`, {
    method: 'POST',
    body: JSON.stringify({ orders: [tracking] }),
  });

  return {
    events: result[tracking]?.events || [],
  };
}

/**
 * Fluxo completo: Cota, adiciona ao carrinho, compra e gera etiqueta
 */
export async function criarEnvioCompleto(order: Order): Promise<{
  melhorEnvioOrderId: string;
  tracking: string | null;
  labelPath: string | null;
  serviceName: string;
  price: number;
}> {
  const log = createOrderLogger(order.invoice_id);

  // 1. Calcular frete e escolher o mais barato
  const servicos = await calcularFrete(order);

  if (servicos.length === 0) {
    throw new MelhorEnvioError(400, 'Nenhum serviço de frete disponível para este CEP');
  }

  // Escolher o mais barato
  const servicoEscolhido = servicos.reduce((prev, curr) =>
    curr.price < prev.price ? curr : prev
  );

  log.info({
    servico: servicoEscolhido.name,
    preco: servicoEscolhido.price,
    prazo: servicoEscolhido.delivery_time,
  }, 'Serviço escolhido');

  // 2. Adicionar ao carrinho
  const cart = await adicionarAoCarrinho(order, servicoEscolhido.id);

  // 3. Fazer checkout
  const checkoutResult = await checkout([cart.id]);

  const melhorEnvioOrderId = checkoutResult.orders[0]?.id || cart.id;
  let tracking = checkoutResult.orders[0]?.tracking || null;

  // 4. Gerar etiqueta
  await gerarEtiqueta(melhorEnvioOrderId);

  // 5. Baixar etiqueta PDF
  let labelPath: string | null = null;
  try {
    labelPath = await imprimirEtiqueta(melhorEnvioOrderId, order.invoice_id);
  } catch (e) {
    log.warn({ error: e }, 'Não foi possível baixar etiqueta ainda');
  }

  // 6. Tentar obter tracking se não veio
  if (!tracking) {
    try {
      const info = await consultarEnvio(melhorEnvioOrderId);
      tracking = info.tracking || null;
    } catch (e) {
      log.warn('Tracking ainda não disponível');
    }
  }

  return {
    melhorEnvioOrderId,
    tracking,
    labelPath,
    serviceName: servicoEscolhido.name,
    price: servicoEscolhido.price,
  };
}

/**
 * Salva arquivo de etiqueta no disco
 */
function saveLabelFile(invoiceId: string, buffer: Buffer): string {
  const labelsDir = join(process.cwd(), 'data', 'labels');

  if (!existsSync(labelsDir)) {
    mkdirSync(labelsDir, { recursive: true });
  }

  const fileName = `${invoiceId}.pdf`;
  const filePath = join(labelsDir, fileName);

  writeFileSync(filePath, buffer);

  return `data/labels/${fileName}`;
}
