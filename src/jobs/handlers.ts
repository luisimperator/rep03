import type { Job } from '../types.js';
import * as repo from '../db/repo.js';
import * as melhorEnvio from '../services/melhorenvio.js';
import * as unnichat from '../services/unnichat.js';
import { createOrderLogger } from '../utils/logger.js';
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
 * Handler: Criar envio via Melhor Envio
 * Processo completo: cotação, carrinho, checkout, etiqueta
 */
async function handleCreateShipment(payload: CreateShipmentPayload): Promise<void> {
  const { invoiceId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info('Processando criação de envio via Melhor Envio');

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
  repo.createEvent('shipment_creating', { invoiceId }, order.id, invoiceId);

  try {
    // Criar envio completo via Melhor Envio (cotação + carrinho + checkout + etiqueta)
    const result = await melhorEnvio.criarEnvioCompleto(order);

    log.info({
      orderId: result.melhorEnvioOrderId,
      tracking: result.tracking,
      service: result.serviceName,
      price: result.price,
    }, 'Envio criado com sucesso');

    // Atualizar pedido com os dados do envio
    const newStatus = result.labelPath ? 'ETIQUETA_GERADA' : 'AGUARDANDO_LOGGI';

    repo.updateOrderStatus(invoiceId, newStatus, {
      loggiShipmentId: result.melhorEnvioOrderId,
      loggiTrackingCode: result.tracking ?? undefined,
      labelPath: result.labelPath ?? undefined,
      errorMessage: null,
    });

    repo.createEvent('shipment_created', {
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
      log.error({ error: message }, 'Erro permanente ao criar envio');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: message,
      });
      repo.createEvent('shipment_failed_permanent', { error: message }, order.id, invoiceId);
      // Não relançar para não fazer retry
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('shipment_failed_transient', { error: message }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Gerar etiqueta via Melhor Envio
 */
async function handleGenerateLabel(payload: GenerateLabelPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info({ shipmentId }, 'Processando geração de etiqueta');

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

    repo.createEvent('label_generated', { labelPath, tracking }, order.id, invoiceId);

    log.info({ labelPath, tracking }, 'Etiqueta gerada com sucesso');

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
      log.error({ error: message }, 'Erro permanente ao gerar etiqueta');
      repo.updateOrderStatus(invoiceId, 'FALHA', {
        errorMessage: `Erro ao gerar etiqueta: ${message}`,
      });
      repo.createEvent('label_failed_permanent', { error: message }, order.id, invoiceId);
      return;
    }

    // Erro transitório - relançar para retry
    repo.createEvent('label_failed_transient', { error: message }, order.id, invoiceId);
    throw error;
  }
}

/**
 * Handler: Verificar status do envio via Melhor Envio
 */
async function handleCheckShipmentStatus(payload: CheckShipmentStatusPayload): Promise<void> {
  const { invoiceId, shipmentId } = payload;
  const log = createOrderLogger(invoiceId);

  log.info({ shipmentId }, 'Verificando status do envio');

  // Buscar pedido
  const order = repo.findOrderByInvoiceId(invoiceId);
  if (!order) {
    throw new Error(`Pedido não encontrado: ${invoiceId}`);
  }

  try {
    const info = await melhorEnvio.consultarEnvio(shipmentId);

    repo.createEvent('shipment_status_checked', {
      status: info.status,
      trackingCode: info.tracking,
    }, order.id, invoiceId);

    // Atualizar tracking code se disponível
    if (info.tracking && !order.loggi_tracking_code) {
      repo.updateOrderStatus(invoiceId, order.status, {
        loggiTrackingCode: info.tracking,
      });
    }

    log.info({ status: info.status, tracking: info.tracking }, 'Status verificado');

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error: message }, 'Erro ao verificar status');
    throw error;
  }
}
