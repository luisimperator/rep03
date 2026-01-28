import { config } from '../config.js';
import { logger, createOrderLogger } from '../utils/logger.js';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Order, LoggiShipmentResponse } from '../types.js';

// Cache do token OAuth
let tokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

/**
 * Obtém access token via OAuth2 client credentials
 * Com cache para evitar requisições desnecessárias
 */
export async function getAccessToken(): Promise<string> {
  // Verificar cache
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) {
    return tokenCache.accessToken;
  }

  const { clientId, clientSecret, baseUrl } = config.loggi;

  if (!clientId || !clientSecret) {
    throw new Error('LOGGI_CLIENT_ID e LOGGI_CLIENT_SECRET são obrigatórios');
  }

  logger.info('Obtendo novo access token da Loggi');

  const response = await fetch(`${baseUrl}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Erro ao obter token Loggi');
    throw new Error(`Erro ao obter token Loggi: ${response.status} - ${error}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  // Atualizar cache
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  logger.info('Token Loggi obtido com sucesso');
  return tokenCache.accessToken;
}

/**
 * Faz requisição autenticada para a API Loggi
 */
async function loggiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAccessToken();
  const { baseUrl } = config.loggi;

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const text = await response.text();
  let data: T;

  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`Resposta inválida da Loggi: ${text}`);
  }

  if (!response.ok) {
    const errorData = data as { message?: string; error?: string };
    throw new LoggiApiError(
      response.status,
      errorData.message || errorData.error || text
    );
  }

  return data;
}

/**
 * Erro específico da API Loggi
 */
export class LoggiApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'LoggiApiError';
  }

  /**
   * Verifica se é um erro transitório (5xx ou timeout)
   */
  isTransient(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }

  /**
   * Verifica se é erro permanente (4xx validação)
   */
  isPermanent(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500 && this.statusCode !== 429;
  }
}

/**
 * Cria um shipment assíncrono na Loggi
 */
export async function createShipment(order: Order): Promise<LoggiShipmentResponse> {
  const log = createOrderLogger(order.invoice_id);
  log.info('Criando shipment na Loggi');

  const { origin, package: pkg, loggi } = config;

  const payload = {
    externalId: order.invoice_id,
    pickup: {
      address: {
        street: origin.street,
        number: origin.number,
        complement: origin.complement || undefined,
        neighborhood: origin.neighborhood,
        city: origin.city,
        state: origin.state,
        zipCode: origin.zip,
        country: 'BR',
      },
      contact: {
        name: origin.name,
        phone: origin.phone,
        email: origin.email,
      },
    },
    delivery: {
      address: {
        street: order.address_street,
        number: order.address_number,
        complement: order.address_complement || undefined,
        neighborhood: order.address_neighborhood,
        city: order.address_city,
        state: order.address_state,
        zipCode: order.address_zip,
        country: order.address_country,
      },
      contact: {
        name: order.buyer_name,
        phone: order.buyer_phone || origin.phone, // Fallback para telefone do remetente
        email: order.buyer_email,
      },
    },
    packages: [
      {
        weightG: pkg.weightG,
        lengthCm: pkg.lengthCm,
        widthCm: pkg.widthCm,
        heightCm: pkg.heightCm,
      },
    ],
  };

  log.debug({ payload }, 'Payload do shipment');

  try {
    const response = await loggiRequest<LoggiShipmentResponse>(
      `/v1/companies/${loggi.companyId}/shipments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    log.info({
      shipmentId: response.id || response.shipmentId,
      trackingCode: response.trackingCode || response.tracking_code,
    }, 'Shipment criado com sucesso');

    return response;
  } catch (error) {
    if (error instanceof LoggiApiError) {
      log.error({
        statusCode: error.statusCode,
        message: error.message,
      }, 'Erro na API Loggi ao criar shipment');
    }
    throw error;
  }
}

/**
 * Gera etiqueta PDF para um shipment
 */
export async function generateLabel(
  shipmentId: string,
  invoiceId: string
): Promise<string> {
  const log = createOrderLogger(invoiceId);
  log.info({ shipmentId }, 'Gerando etiqueta na Loggi');

  const { loggi } = config;

  try {
    const token = await getAccessToken();
    const { baseUrl } = config.loggi;

    const response = await fetch(
      `${baseUrl}/v1/companies/${loggi.companyId}/shipments/${shipmentId}/labels`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/pdf',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new LoggiApiError(response.status, errorText);
    }

    // Verificar content-type
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/pdf')) {
      // Pode ser JSON com URL do PDF
      const data = await response.json() as { url?: string; labelUrl?: string };
      if (data.url || data.labelUrl) {
        // Baixar PDF da URL
        const pdfUrl = data.url || data.labelUrl!;
        return await downloadAndSaveLabel(pdfUrl, invoiceId, log);
      }
      throw new Error('Formato de resposta da etiqueta não reconhecido');
    }

    // Salvar PDF diretamente
    const buffer = await response.arrayBuffer();
    const labelPath = saveLabelFile(invoiceId, Buffer.from(buffer));

    log.info({ labelPath }, 'Etiqueta salva com sucesso');
    return labelPath;
  } catch (error) {
    if (error instanceof LoggiApiError) {
      log.error({
        statusCode: error.statusCode,
        message: error.message,
      }, 'Erro na API Loggi ao gerar etiqueta');
    }
    throw error;
  }
}

/**
 * Baixa PDF de uma URL e salva localmente
 */
async function downloadAndSaveLabel(
  url: string,
  invoiceId: string,
  log: ReturnType<typeof createOrderLogger>
): Promise<string> {
  log.info({ url }, 'Baixando PDF da etiqueta');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro ao baixar etiqueta: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const labelPath = saveLabelFile(invoiceId, Buffer.from(buffer));

  log.info({ labelPath }, 'Etiqueta baixada e salva com sucesso');
  return labelPath;
}

/**
 * Salva arquivo de etiqueta no disco
 */
function saveLabelFile(invoiceId: string, buffer: Buffer): string {
  const labelsDir = join(process.cwd(), 'data', 'labels');

  // Garantir que o diretório existe
  if (!existsSync(labelsDir)) {
    mkdirSync(labelsDir, { recursive: true });
  }

  const fileName = `${invoiceId}.pdf`;
  const filePath = join(labelsDir, fileName);

  writeFileSync(filePath, buffer);

  // Retornar caminho relativo
  return `data/labels/${fileName}`;
}

/**
 * Verifica status de um shipment
 */
export async function getShipmentStatus(shipmentId: string): Promise<{
  status: string;
  trackingCode?: string;
}> {
  const { loggi } = config;

  const response = await loggiRequest<{
    status?: string;
    trackingCode?: string;
    tracking_code?: string;
  }>(`/v1/companies/${loggi.companyId}/shipments/${shipmentId}`, {
    method: 'GET',
  });

  return {
    status: response.status || 'unknown',
    trackingCode: response.trackingCode || response.tracking_code,
  };
}

/**
 * Cancela um shipment (se suportado)
 */
export async function cancelShipment(shipmentId: string): Promise<void> {
  const { loggi } = config;

  await loggiRequest(
    `/v1/companies/${loggi.companyId}/shipments/${shipmentId}/cancel`,
    {
      method: 'POST',
    }
  );

  logger.info({ shipmentId }, 'Shipment cancelado');
}
