import type { Job } from '../types.js';
import * as repo from '../db/repo.js';
import * as melhorEnvio from '../services/melhorenvio.js';
import * as loggi from '../services/loggi.js';
import * as unnichat from '../services/unnichat.js';
import { createOrderLogger } from '../utils/logger.js';
import { config } from '../config.js';
import {
  JOB_TYPES,
  enqueueGenerateLabel,
  type CreateShipmentPayload,
  type GenerateLabelPayload,
  type CheckShipmentStatusPayload,
} from './queue.js';

/**
 * Processa um job baseado no seu tipo
 */
export async function processJob(job: Job): Promise<void> {
  const payload = JSON.parse(job.payload);

  switch (job.type) {
    case JOB_TYPES.CREATE_SHIPMENT:
      await handleCreateShipment(payload as CreateShipmentPayload);
      break;

    case JOB_TYPES.GENERATE_LABEL:
      await handleGenerateLabel(payload as GenerateLabelPayload);
      break;

    case JOB_TYPES.CHECK_SHIPMENT_STATUS:
      await handleCheckShipmentStatus(payload as CheckShipmentStatusPayload);
      break;

    default:
      throw new Error(`Tipo de job desconhecido: ${job.type}`);
  }
}

/**
 * Handler: Criar envio
 * Usa Loggi diretamente ou Melhor Envio baseado na configuração
 */
async function handleCreateShipment(payload: CreateShipmentPayload): Promise<void> {
  const { invoiceId } = payload;
  const log = createOrderLogger(invoiceId);

  const provider = config.shippingProvider;
  log.info({ provider }, 'Processando criação de envio');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  // Verificar se já foi criado
  if (order.loggi_shipment_id) {
    log.warn('Envio já existe, pulando criação');
    return;
  }

  // Atualizar status
  repo.updateOrderStatus(invoiceId, 'ENVIANDO');
  repo.createEvent('shipment_creating', { invoiceId, provider }, order.id, invoiceId);

  if (provider === 'loggi') {
    await handleCreateShipmentLoggi(order, invoiceId, log);
  } else {
    await handleCreateShipmentMelhorEnvio(order, invoiceId, log);
  }
}

/**
 * Criar envio via Loggi diretamente
 */
async function handleCreateShipmentLoggi(
  order: NonNullable<ReturnType<typeof repo.findOrderByInvoiceId>>,
  invoiceId: string,
  log: ReturnType<typeof createOrderLogger>
): Promise<void> {
  try {
    // Criar shipment na Loggi
    const shipmentResponse = await loggi.createShipment(order);

    const shipmentId = shipmentResponse.id || shipmentResponse.shipmentId || '';
    const trackingCode = shipmentResponse.trackingCode || shipmentResponse.tracking_code || null;

    log.info({
      shipmentId,
      trackingCode,
    }, 'Shipment criado na Loggi');

    // Gerar etiqueta
    let labelPath: string | null = null;
    if (shipmentId) {
      try {
        labelPath = await loggi.generateLabel(shipmentId, invoiceId);
        log.info({ labelPath }, 'Etiqueta gerada com sucesso');
      } catch (labelError) {
        log.warn({ error: labelError instanceof Error ? labelError.message : String(labelError) },
          'Não foi possível gerar etiqueta agora, será tentado depois');
      }
    }

    // Atualizar pedido com os dados do envio
    const newStatus = labelPath ? 'ETIQUETA_GERADA' : 'AGUARDANDO_LOGGI';

    repo.updateOrderStatus(invoiceId, newStatus, {
      loggiShipmentId: shipmentId,
      loggiTrackingCode: trackingCode ?? undefined,
      labelPath: labelPath ?? undefined,
      errorMessage: null,
    });

    repo.createEvent('shipment_created', {
      provider: 'loggi',
      shipmentId,
      trackingCode,
      labelPath,
    }, order.id, invoiceId);

    // Se não conseguiu gerar etiqueta, enfileirar para tentar depois
    if (!labelPath && shipmentId) {
      log.info('Etiqueta não disponível ainda, enfileirando geração');
      enqueueGenerateLabel(invoiceId, shipmentId);
    }

    // Enviar código de rastreio via WhatsApp (se configurado)
    if (trackingCode) {
      const updatedOrder = repo.findOrderByInvoiceId(invoiceId);
      if (updatedOrder) {
        const whatsappSent = await unnichat.enviarCodigoRastreio(updatedOrder);
        if (whatsappSent) {
          repo.createEvent('whatsapp_tracking_sent', { tracking: trackingCode }, order.id, invoiceId);
        }
      }
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente (4xx exceto 429)
    if (error instanceof loggi.LoggiApiError && !error.isTransient()) {
      log.error({ error: message }, 'Erro permanente ao criar envio na Loggi');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: message,
      });
      repo.createEvent('shipment_failed_permanent', { error: message, provider: 'loggi' }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('shipment_failed_transient', { error: message, provider: 'loggi' }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Criar envio via Melhor Envio
 * Processo completo: cotação, carrinho, checkout, etiqueta
 */
async function handleCreateShipmentMelhorEnvio(
  order: NonNullable<ReturnType<typeof repo.findOrderByInvoiceId>>,
  invoiceId: string,
  log: ReturnType<typeof createOrderLogger>
): Promise<void> {
  try {
    // Criar envio completo via Melhor Envio (cotação + carrinho + checkout + etiqueta)
    const result = await melhorEnvio.criarEnvioCompleto(order);

    log.info({
      orderId: result.melhorEnvioOrderId,
      tracking: result.tracking,
      service: result.serviceName,
      price: result.price,
    }, 'Envio criado com sucesso via Melhor Envio');

    // Atualizar pedido com os dados do envio
    const newStatus = result.labelPath ? 'ETIQUETA_GERADA' : 'AGUARDANDO_LOGGI';

    repo.updateOrderStatus(invoiceId, newStatus, {
      loggiShipmentId: result.melhorEnvioOrderId,
      loggiTrackingCode: result.tracking ?? undefined,
      labelPath: result.labelPath ?? undefined,
      errorMessage: null,
    });

    repo.createEvent('shipment_created', {
      provider: 'melhorenvio',
      shipmentId: result.melhorEnvioOrderId,
      trackingCode: result.tracking,
      serviceName: result.serviceName,
      price: result.price,
      labelPath: result.labelPath,
    }, order.id, invoiceId);

    // Se não conseguiu gerar etiqueta, enfileirar para tentar depois
    if (!result.labelPath && result.melhorEnvioOrderId) {
      log.info('Etiqueta não disponível ainda, enfileirando geração');
      enqueueGenerateLabel(invoiceId, result.melhorEnvioOrderId);
    }

    // Enviar código de rastreio via WhatsApp (se configurado)
    if (result.tracking) {
      const updatedOrder = repo.findOrderByInvoiceId(invoiceId);
      if (updatedOrder) {
        const whatsappSent = await unnichat.enviarCodigoRastreio(updatedOrder);
        if (whatsappSent) {
          repo.createEvent('whatsapp_tracking_sent', { tracking: result.tracking }, order.id, invoiceId);
        }
      }
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente (4xx exceto 429)
    if (error instanceof melhorEnvio.MelhorEnvioError && !error.isTransient()) {
      log.error({ error: message }, 'Erro permanente ao criar envio via Melhor Envio');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: message,
      });
      repo.createEvent('shipment_failed_permanent', { error: message, provider: 'melhorenvio' }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('shipment_failed_transient', { error: message, provider: 'melhorenvio' }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Gerar etiqueta
 * Usa Loggi ou Melhor Envio baseado na configuração
 */
async function handleGenerateLabel(payload: GenerateLabelPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  const provider = config.shippingProvider;
  log.info({ shipmentId, provider }, 'Processando geração de etiqueta');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  // Verificar se já tem etiqueta
  if (order.label_path) {
    log.warn('Etiqueta já existe, pulando geração');
    return;
  }

  if (provider === 'loggi') {
    await handleGenerateLabelLoggi(order, invoiceId, shipmentId, log);
  } else {
    await handleGenerateLabelMelhorEnvio(order, invoiceId, shipmentId, log);
  }
}

/**
 * Gerar etiqueta via Loggi
 */
async function handleGenerateLabelLoggi(
  order: NonNullable<ReturnType<typeof repo.findOrderByInvoiceId>>,
  invoiceId: string,
  shipmentId: string,
  log: ReturnType<typeof createOrderLogger>
): Promise<void> {
  try {
    // Gerar e baixar etiqueta
    const labelPath = await loggi.generateLabel(shipmentId, invoiceId);

    // Tentar obter tracking se não temos
    let tracking = order.loggi_tracking_code;
    if (!tracking) {
      try {
        const status = await loggi.getShipmentStatus(shipmentId);
        tracking = status.trackingCode || null;
      } catch {
        log.warn('Tracking ainda não disponível');
      }
    }

    // Atualizar pedido
    repo.updateOrderStatus(invoiceId, 'ETIQUETA_GERADA', {
      labelPath,
      loggiTrackingCode: tracking ?? undefined,
      errorMessage: null,
    });

    repo.createEvent('label_generated', { labelPath, tracking, provider: 'loggi' }, order.id, invoiceId);

    log.info({ labelPath, tracking }, 'Etiqueta gerada com sucesso via Loggi');

    // Enviar código de rastreio via WhatsApp (se configurado e tiver tracking)
    if (tracking) {
      const updatedOrder = repo.findOrderByInvoiceId(invoiceId);
      if (updatedOrder) {
        const whatsappSent = await unnichat.enviarCodigoRastreio(updatedOrder);
        if (whatsappSent) {
          repo.createEvent('whatsapp_tracking_sent', { tracking }, order.id, invoiceId);
        }
      }
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente
    if (error instanceof loggi.LoggiApiError && !error.isTransient()) {
      log.error({ error: message }, 'Erro permanente ao gerar etiqueta via Loggi');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: `Erro ao gerar etiqueta: ${message}`,
      });
      repo.createEvent('label_failed_permanent', { error: message, provider: 'loggi' }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('label_failed_transient', { error: message, provider: 'loggi' }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Gerar etiqueta via Melhor Envio
 */
async function handleGenerateLabelMelhorEnvio(
  order: NonNullable<ReturnType<typeof repo.findOrderByInvoiceId>>,
  invoiceId: string,
  shipmentId: string,
  log: ReturnType<typeof createOrderLogger>
): Promise<void> {
  try {
    // Primeiro, gerar a etiqueta no Melhor Envio
    await melhorEnvio.gerarEtiqueta(shipmentId);

    // Depois, baixar o PDF
    const labelPath = await melhorEnvio.imprimirEtiqueta(shipmentId, invoiceId);

    // Tentar obter tracking se não temos
    let tracking = order.loggi_tracking_code;
    if (!tracking) {
      try {
        const info = await melhorEnvio.consultarEnvio(shipmentId);
        tracking = info.tracking || null;
      } catch {
        log.warn('Tracking ainda não disponível');
      }
    }

    // Atualizar pedido
    repo.updateOrderStatus(invoiceId, 'ETIQUETA_GERADA', {
      labelPath,
      loggiTrackingCode: tracking ?? undefined,
      errorMessage: null,
    });

    repo.createEvent('label_generated', { labelPath, tracking, provider: 'melhorenvio' }, order.id, invoiceId);

    log.info({ labelPath, tracking }, 'Etiqueta gerada com sucesso via Melhor Envio');

    // Enviar código de rastreio via WhatsApp (se configurado e tiver tracking)
    if (tracking) {
      const updatedOrder = repo.findOrderByInvoiceId(invoiceId);
      if (updatedOrder) {
        const whatsappSent = await unnichat.enviarCodigoRastreio(updatedOrder);
        if (whatsappSent) {
          repo.createEvent('whatsapp_tracking_sent', { tracking }, order.id, invoiceId);
        }
      }
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Verificar se é erro permanente
    if (error instanceof melhorEnvio.MelhorEnvioError && !error.isTransient()) {
      log.error({ error: message }, 'Erro permanente ao gerar etiqueta via Melhor Envio');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: `Erro ao gerar etiqueta: ${message}`,
      });
      repo.createEvent('label_failed_permanent', { error: message, provider: 'melhorenvio' }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('label_failed_transient', { error: message, provider: 'melhorenvio' }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Verificar status do envio
 * Usa Loggi ou Melhor Envio baseado na configuração
 */
async function handleCheckShipmentStatus(payload: CheckShipmentStatusPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  const provider = config.shippingProvider;
  log.info({ shipmentId, provider }, 'Verificando status do envio');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  try {
    let status: string;
    let tracking: string | null | undefined;

    if (provider === 'loggi') {
      const result = await loggi.getShipmentStatus(shipmentId);
      status = result.status;
      tracking = result.trackingCode;
    } else {
      const info = await melhorEnvio.consultarEnvio(shipmentId);
      status = info.status;
      tracking = info.tracking;
    }

    repo.createEvent('shipment_status_checked', {
      status,
      trackingCode: tracking,
      provider,
    }, order.id, invoiceId);

    // Atualizar tracking code se disponível
    if (tracking && !order.loggi_tracking_code) {
      repo.updateOrderStatus(invoiceId, order.status, {
        loggiTrackingCode: tracking,
      });
    }

    log.info({ status, tracking }, 'Status verificado');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Erro ao verificar status');
    throw error;
  }
}
