import { config } from '../config.js';
import { verifyHmacSignatureString } from '../utils/crypto.js';
import { sanitizeCep, sanitizePhone, normalizeUF, normalizeCountry, sanitizeString } from '../utils/validators.js';
import type { EduzzWebhookPayload, ParsedEduzzData, EduzzAddress, EduzzItem } from '../types.js';
import { logger } from '../utils/logger.js';

const ACCEPTED_EVENT = 'myeduzz.invoice_paid';

/**
 * Verifica assinatura HMAC-SHA256 do webhook Eduzz
 */
export function verifyEduzzSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) {
    logger.warn('Webhook Eduzz recebido sem assinatura x-signature');
    return false;
  }

  const isValid = verifyHmacSignatureString(
    config.eduzz.webhookSecret,
    rawBody,
    signature
  );

  if (!isValid) {
    logger.warn('Assinatura do webhook Eduzz inválida');
  }

  return isValid;
}

/**
 * Verifica se o evento é aceito (invoice_paid)
 */
export function isAcceptedEvent(event: string): boolean {
  return event === ACCEPTED_EVENT;
}

/**
 * Verifica se algum item do payload está na allowlist de produtos
 */
export function hasAllowedProduct(items: EduzzItem[]): boolean {
  const { allowedProductIds, allowedSkus } = config.eduzz;

  // Se ambas as listas estão vazias, aceitar todos
  if (allowedProductIds.length === 0 && allowedSkus.length === 0) {
    logger.debug('Allowlist vazia, aceitando todos os produtos');
    return true;
  }

  for (const item of items) {
    // Verificar por product ID
    const productId = String(item.productId || item.product_id || item.id || '');
    if (productId && allowedProductIds.includes(productId)) {
      logger.debug({ productId }, 'Produto encontrado na allowlist por ID');
      return true;
    }

    // Verificar por SKU
    const sku = item.skuReference || item.sku_reference || item.sku || '';
    if (sku && allowedSkus.includes(sku)) {
      logger.debug({ sku }, 'Produto encontrado na allowlist por SKU');
      return true;
    }
  }

  logger.debug('Nenhum produto na allowlist encontrado');
  return false;
}

/**
 * Extrai e filtra apenas os itens permitidos
 */
function filterAllowedItems(items: EduzzItem[]): EduzzItem[] {
  const { allowedProductIds, allowedSkus } = config.eduzz;

  // Se ambas as listas estão vazias, retornar todos
  if (allowedProductIds.length === 0 && allowedSkus.length === 0) {
    return items;
  }

  return items.filter(item => {
    const productId = String(item.productId || item.product_id || item.id || '');
    const sku = item.skuReference || item.sku_reference || item.sku || '';

    return (
      (productId && allowedProductIds.includes(productId)) ||
      (sku && allowedSkus.includes(sku))
    );
  });
}

/**
 * Extrai CEP de diferentes campos do endereço
 */
function extractZipCode(address: EduzzAddress): string {
  const raw = address.zipCode || address.zip_code || address.cep || '';
  return sanitizeCep(raw);
}

/**
 * Parseia o payload do webhook Eduzz para formato interno
 */
export function parseEduzzPayload(payload: EduzzWebhookPayload): ParsedEduzzData | null {
  const { data } = payload;

  if (!data) {
    logger.error('Payload Eduzz sem campo data');
    return null;
  }

  // Extrair invoice ID
  const invoiceId = String(data.id);
  if (!invoiceId || invoiceId === 'undefined') {
    logger.error('Payload Eduzz sem invoice ID');
    return null;
  }

  // Extrair buyer (pode estar em buyer ou customer)
  const buyerData = data.buyer || data.customer || {};
  const buyer = {
    name: sanitizeString(buyerData.name) || 'Cliente',
    email: sanitizeString(buyerData.email) || 'nao@informado.com',
    phone: sanitizePhone(buyerData.phone || buyerData.cellphone) || null,
  };

  // Extrair endereço (pode estar em address ou shipping_address)
  const addressData = data.address || data.shipping_address || {};
  const address = {
    street: sanitizeString(addressData.street) || 'Não informado',
    number: String(addressData.number || 'S/N'),
    complement: sanitizeString(addressData.complement) || null,
    neighborhood: sanitizeString(addressData.neighborhood) || 'Centro',
    city: sanitizeString(addressData.city) || 'Não informada',
    state: normalizeUF(addressData.state),
    zipCode: extractZipCode(addressData),
    country: normalizeCountry(addressData.country),
  };

  // Extrair itens (pode estar em items ou products)
  const rawItems = data.items || data.products || [];
  const allowedItems = filterAllowedItems(rawItems);

  const items = allowedItems.map(item => ({
    productId: String(item.productId || item.product_id || item.id || 'unknown'),
    name: sanitizeString(item.name || item.title) || 'Produto',
    skuReference: item.skuReference || item.sku_reference || item.sku || null,
    quantity: item.qty || item.quantity || 1,
    price: item.price || item.value || 0,
  }));

  // Extrair data de pagamento
  const paidAt = data.paid_at || data.payment_date || new Date().toISOString();

  // Extrair transaction ID
  const transactionId = data.transaction
    ? String(data.transaction.key || data.transaction.id || null)
    : null;

  return {
    invoiceId,
    buyer,
    address,
    items,
    paidAt,
    transactionId,
  };
}

/**
 * Valida o payload completo do webhook
 * Retorna objeto de erro ou null se válido
 */
export function validateWebhookPayload(
  rawBody: string,
  signature: string | undefined,
  payload: EduzzWebhookPayload
): { valid: false; reason: string } | { valid: true } {
  // Verificar assinatura
  if (!verifyEduzzSignature(rawBody, signature)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  // Verificar evento
  if (!isAcceptedEvent(payload.event)) {
    return { valid: false, reason: 'event_not_accepted' };
  }

  // Verificar se tem itens permitidos
  const items = payload.data?.items || payload.data?.products || [];
  if (!hasAllowedProduct(items)) {
    return { valid: false, reason: 'no_allowed_products' };
  }

  return { valid: true };
}
