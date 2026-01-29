/**
 * Serviço de integração com Unnichat (WhatsApp)
 * Envia código de rastreio automaticamente para o cliente
 */

import { config } from '../config.js';
import { logger, createOrderLogger } from '../utils/logger.js';
import type { Order } from '../types.js';

/**
 * Erro da API Unnichat
 */
export class UnnichatError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'UnnichatError';
  }

  isTransient(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

/**
 * Faz requisição para a API do Unnichat
 */
async function unnichatRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const { apiUrl, token } = config.unnichat;

  if (!apiUrl || !token) {
    throw new UnnichatError(400, 'Unnichat não configurado (API_URL ou TOKEN faltando)');
  }

  const url = `${apiUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });

  const text = await response.text();
  let data: T;

  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new UnnichatError(response.status, `Resposta inválida: ${text}`);
  }

  if (!response.ok) {
    const errorData = data as { message?: string; error?: string };
    const message = errorData.message || errorData.error || text;
    throw new UnnichatError(response.status, message, errorData);
  }

  return data;
}

/**
 * Formata número de telefone para WhatsApp (55 + DDD + número)
 */
function formatPhoneForWhatsApp(phone: string | null): string | null {
  if (!phone) return null;

  // Remove tudo que não for dígito
  let digits = phone.replace(/\D/g, '');

  // Se já começa com 55, assumir que está correto
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }

  // Se tem 10 ou 11 dígitos, adicionar 55 (Brasil)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  // Retornar como está se não conseguir formatar
  return digits.length >= 10 ? digits : null;
}

/**
 * Envia mensagem de código de rastreio via WhatsApp
 */
export async function enviarCodigoRastreio(order: Order): Promise<boolean> {
  const log = createOrderLogger(order.invoice_id);

  // Verificar se Unnichat está habilitado
  if (!config.unnichat.enabled) {
    log.debug('Unnichat desabilitado, pulando envio de WhatsApp');
    return false;
  }

  // Verificar se tem código de rastreio
  if (!order.loggi_tracking_code) {
    log.warn('Pedido sem código de rastreio, não é possível enviar WhatsApp');
    return false;
  }

  // Formatar telefone
  const phone = formatPhoneForWhatsApp(order.buyer_phone);
  if (!phone) {
    log.warn({ phone: order.buyer_phone }, 'Telefone inválido para WhatsApp');
    return false;
  }

  log.info({ phone, tracking: order.loggi_tracking_code }, 'Enviando código de rastreio via WhatsApp');

  // Montar mensagem
  const message = montarMensagemRastreio(order);

  try {
    await unnichatRequest('/meta/messages', {
      method: 'POST',
      body: JSON.stringify({
        to: phone,
        type: 'text',
        text: {
          body: message,
        },
      }),
    });

    log.info('Mensagem WhatsApp enviada com sucesso');
    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error({ error: errorMessage }, 'Erro ao enviar WhatsApp');

    // Não relançar - envio de WhatsApp é best-effort
    return false;
  }
}

/**
 * Monta mensagem de rastreio personalizada
 */
function montarMensagemRastreio(order: Order): string {
  const nome = order.buyer_name.split(' ')[0]; // Primeiro nome
  const tracking = order.loggi_tracking_code;

  return `Olá ${nome}! 🎉

Seu pedido do Canal do Anfitrião foi postado!

📦 *Código de rastreio:* ${tracking}

Você pode acompanhar a entrega em:
https://www.melhorrastreio.com.br/rastreio/${tracking}

Qualquer dúvida, estamos à disposição!

Canal do Anfitrião`;
}

/**
 * Envia mensagem customizada via WhatsApp
 */
export async function enviarMensagem(
  phone: string,
  message: string
): Promise<boolean> {
  // Verificar se Unnichat está habilitado
  if (!config.unnichat.enabled) {
    logger.debug('Unnichat desabilitado');
    return false;
  }

  const formattedPhone = formatPhoneForWhatsApp(phone);
  if (!formattedPhone) {
    logger.warn({ phone }, 'Telefone inválido para WhatsApp');
    return false;
  }

  try {
    await unnichatRequest('/meta/messages', {
      method: 'POST',
      body: JSON.stringify({
        to: formattedPhone,
        type: 'text',
        text: {
          body: message,
        },
      }),
    });

    logger.info({ phone: formattedPhone }, 'Mensagem WhatsApp enviada');
    return true;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage, phone: formattedPhone }, 'Erro ao enviar WhatsApp');
    return false;
  }
}

/**
 * Verifica se Unnichat está configurado e funcionando
 */
export async function verificarConexao(): Promise<boolean> {
  if (!config.unnichat.enabled) {
    return false;
  }

  try {
    await unnichatRequest('/status', { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}
