import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as repo from '../db/repo.js';
import { enqueueCreateShipment, getQueueStats } from '../jobs/queue.js';
import { logger, createOrderLogger } from '../utils/logger.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Order, OrderItem, Event, OrderStatus } from '../types.js';

/**
 * Gera HTML do painel admin
 */
function renderAdminPage(data: {
  orders: Order[];
  counts: Record<OrderStatus, number>;
  queueStats: { pending: number; failed: number };
}): string {
  const { orders, counts, queueStats } = data;

  const statusColors: Record<OrderStatus, string> = {
    NOVO: 'bg-blue-100 text-blue-800',
    ENVIANDO: 'bg-yellow-100 text-yellow-800',
    AGUARDANDO_LOGGI: 'bg-purple-100 text-purple-800',
    ETIQUETA_GERADA: 'bg-green-100 text-green-800',
    FALHA: 'bg-red-100 text-red-800',
    POSTADO: 'bg-gray-100 text-gray-800',
  };

  const orderRows = orders.map(order => {
    const items = repo.getOrderItems(order.id);
    const productNames = items.map(i => i.product_name).join(', ');

    return `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-sm text-gray-500">${new Date(order.created_at).toLocaleString('pt-BR')}</td>
        <td class="px-4 py-3">
          <a href="/admin/order/${order.invoice_id}" class="text-blue-600 hover:underline font-medium">
            ${order.invoice_id}
          </a>
        </td>
        <td class="px-4 py-3">
          <div class="font-medium text-gray-900">${escapeHtml(order.buyer_name)}</div>
          <div class="text-sm text-gray-500">${escapeHtml(order.buyer_email)}</div>
        </td>
        <td class="px-4 py-3 text-sm">${escapeHtml(order.address_city)}/${order.address_state}</td>
        <td class="px-4 py-3 text-sm" title="${escapeHtml(productNames)}">${escapeHtml(truncate(productNames, 30))}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 text-xs font-medium rounded-full ${statusColors[order.status]}">
            ${order.status}
          </span>
        </td>
        <td class="px-4 py-3 text-sm">
          <div class="flex gap-2">
            ${order.label_path ? `
              <a href="/labels/${order.invoice_id}" target="_blank"
                 class="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700">
                Etiqueta
              </a>
            ` : ''}
            ${order.status === 'FALHA' ? `
              <form method="POST" action="/admin/order/${order.invoice_id}/reprocess" class="inline">
                <button type="submit"
                        class="px-3 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">
                  Reprocessar
                </button>
              </form>
            ` : ''}
            ${order.status === 'ETIQUETA_GERADA' ? `
              <form method="POST" action="/admin/order/${order.invoice_id}/mark-posted" class="inline">
                <button type="submit"
                        class="px-3 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700">
                  Postado
                </button>
              </form>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eduzz → Loggi | Painel Admin</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <meta http-equiv="refresh" content="30">
</head>
<body class="bg-gray-100 min-h-screen">
  <nav class="bg-white shadow-sm border-b">
    <div class="max-w-7xl mx-auto px-4 py-4">
      <h1 class="text-xl font-bold text-gray-800">Eduzz → Loggi Automation</h1>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto px-4 py-8">
    <!-- Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-blue-600">${counts.NOVO}</div>
        <div class="text-sm text-gray-500">Novos</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-yellow-600">${counts.ENVIANDO}</div>
        <div class="text-sm text-gray-500">Enviando</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-purple-600">${counts.AGUARDANDO_LOGGI}</div>
        <div class="text-sm text-gray-500">Aguardando</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-green-600">${counts.ETIQUETA_GERADA}</div>
        <div class="text-sm text-gray-500">Etiquetas</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-red-600">${counts.FALHA}</div>
        <div class="text-sm text-gray-500">Falhas</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-gray-600">${counts.POSTADO}</div>
        <div class="text-sm text-gray-500">Postados</div>
      </div>
      <div class="bg-white rounded-lg shadow p-4">
        <div class="text-2xl font-bold text-indigo-600">${queueStats.pending}</div>
        <div class="text-sm text-gray-500">Na Fila</div>
      </div>
    </div>

    <!-- Orders Table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-4 py-3 border-b bg-gray-50">
        <h2 class="font-semibold text-gray-700">Pedidos Recentes</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 border-b">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Comprador</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cidade/UF</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Produto</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            ${orderRows || '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Nenhum pedido encontrado</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <footer class="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
    Atualização automática a cada 30 segundos
  </footer>
</body>
</html>
  `;
}

/**
 * Gera HTML da página de detalhes do pedido
 */
function renderOrderPage(order: Order, items: OrderItem[], events: Event[]): string {
  const statusColors: Record<OrderStatus, string> = {
    NOVO: 'bg-blue-100 text-blue-800',
    ENVIANDO: 'bg-yellow-100 text-yellow-800',
    AGUARDANDO_LOGGI: 'bg-purple-100 text-purple-800',
    ETIQUETA_GERADA: 'bg-green-100 text-green-800',
    FALHA: 'bg-red-100 text-red-800',
    POSTADO: 'bg-gray-100 text-gray-800',
  };

  const itemRows = items.map(item => `
    <tr>
      <td class="px-4 py-2">${escapeHtml(item.product_name)}</td>
      <td class="px-4 py-2">${item.product_id}</td>
      <td class="px-4 py-2">${item.sku_reference || '-'}</td>
      <td class="px-4 py-2">${item.quantity}</td>
      <td class="px-4 py-2">R$ ${item.price.toFixed(2)}</td>
    </tr>
  `).join('');

  const eventRows = events.map(event => `
    <tr class="text-sm">
      <td class="px-4 py-2 text-gray-500">${new Date(event.created_at).toLocaleString('pt-BR')}</td>
      <td class="px-4 py-2 font-medium">${event.event_type}</td>
      <td class="px-4 py-2 text-gray-600">
        <pre class="text-xs overflow-x-auto max-w-md">${escapeHtml(event.payload || '-')}</pre>
      </td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pedido ${order.invoice_id} | Eduzz → Loggi</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
  <nav class="bg-white shadow-sm border-b">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
      <a href="/admin" class="text-blue-600 hover:underline">&larr; Voltar</a>
      <h1 class="text-xl font-bold text-gray-800">Pedido ${order.invoice_id}</h1>
      <span class="px-2 py-1 text-xs font-medium rounded-full ${statusColors[order.status]}">
        ${order.status}
      </span>
    </div>
  </nav>

  <main class="max-w-7xl mx-auto px-4 py-8 space-y-6">
    <!-- Info Cards -->
    <div class="grid md:grid-cols-2 gap-6">
      <!-- Comprador -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="font-semibold text-gray-700 mb-4">Comprador</h2>
        <dl class="space-y-2">
          <div><dt class="text-sm text-gray-500">Nome</dt><dd class="font-medium">${escapeHtml(order.buyer_name)}</dd></div>
          <div><dt class="text-sm text-gray-500">Email</dt><dd>${escapeHtml(order.buyer_email)}</dd></div>
          <div><dt class="text-sm text-gray-500">Telefone</dt><dd>${order.buyer_phone || '-'}</dd></div>
        </dl>
      </div>

      <!-- Endereço -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="font-semibold text-gray-700 mb-4">Endereço de Entrega</h2>
        <address class="not-italic text-gray-600">
          ${escapeHtml(order.address_street)}, ${order.address_number}<br>
          ${order.address_complement ? escapeHtml(order.address_complement) + '<br>' : ''}
          ${escapeHtml(order.address_neighborhood)}<br>
          ${escapeHtml(order.address_city)} - ${order.address_state}<br>
          CEP: ${order.address_zip}<br>
          ${order.address_country}
        </address>
      </div>
    </div>

    <!-- Loggi Info -->
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="font-semibold text-gray-700 mb-4">Informações Loggi</h2>
      <dl class="grid md:grid-cols-3 gap-4">
        <div>
          <dt class="text-sm text-gray-500">Shipment ID</dt>
          <dd class="font-mono">${order.loggi_shipment_id || '-'}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-500">Tracking Code</dt>
          <dd class="font-mono">${order.loggi_tracking_code || '-'}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-500">Etiqueta</dt>
          <dd>
            ${order.label_path
              ? `<a href="/labels/${order.invoice_id}" target="_blank" class="text-blue-600 hover:underline">Baixar PDF</a>`
              : '-'}
          </dd>
        </div>
      </dl>
      ${order.error_message ? `
        <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          <strong>Erro:</strong> ${escapeHtml(order.error_message)}
        </div>
      ` : ''}
    </div>

    <!-- Actions -->
    <div class="bg-white rounded-lg shadow p-6">
      <h2 class="font-semibold text-gray-700 mb-4">Ações</h2>
      <div class="flex gap-4">
        ${order.label_path ? `
          <a href="/labels/${order.invoice_id}" target="_blank"
             class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            Baixar Etiqueta
          </a>
        ` : ''}
        ${order.status === 'FALHA' || order.status === 'NOVO' ? `
          <form method="POST" action="/admin/order/${order.invoice_id}/reprocess" class="inline">
            <button type="submit"
                    class="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700">
              Reprocessar
            </button>
          </form>
        ` : ''}
        ${order.status === 'ETIQUETA_GERADA' ? `
          <form method="POST" action="/admin/order/${order.invoice_id}/mark-posted" class="inline">
            <button type="submit"
                    class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
              Marcar como Postado
            </button>
          </form>
        ` : ''}
      </div>
    </div>

    <!-- Items -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-4 py-3 border-b bg-gray-50">
        <h2 class="font-semibold text-gray-700">Itens do Pedido</h2>
      </div>
      <table class="w-full">
        <thead class="bg-gray-50 border-b text-xs text-gray-500 uppercase">
          <tr>
            <th class="px-4 py-2 text-left">Produto</th>
            <th class="px-4 py-2 text-left">ID</th>
            <th class="px-4 py-2 text-left">SKU</th>
            <th class="px-4 py-2 text-left">Qtd</th>
            <th class="px-4 py-2 text-left">Preço</th>
          </tr>
        </thead>
        <tbody class="divide-y">${itemRows}</tbody>
      </table>
    </div>

    <!-- Events Log -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-4 py-3 border-b bg-gray-50">
        <h2 class="font-semibold text-gray-700">Log de Eventos</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="bg-gray-50 border-b text-xs text-gray-500 uppercase">
            <tr>
              <th class="px-4 py-2 text-left">Data/Hora</th>
              <th class="px-4 py-2 text-left">Evento</th>
              <th class="px-4 py-2 text-left">Detalhes</th>
            </tr>
          </thead>
          <tbody class="divide-y">${eventRows || '<tr><td colspan="3" class="px-4 py-4 text-center text-gray-500">Sem eventos</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  </main>
</body>
</html>
  `;
}

/**
 * Escapa HTML para prevenir XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Trunca string
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Registra rotas admin
 */
export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /admin
   * Painel principal com lista de pedidos
   */
  fastify.get('/admin', async (request: FastifyRequest, reply: FastifyReply) => {
    const orders = repo.getAllOrders(100);
    const counts = repo.countOrdersByStatus();
    const queueStats = getQueueStats();

    const html = renderAdminPage({ orders, counts, queueStats });
    return reply.type('text/html').send(html);
  });

  /**
   * GET /admin/order/:invoiceId
   * Detalhes de um pedido específico
   */
  fastify.get('/admin/order/:invoiceId', async (
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply
  ) => {
    const { invoiceId } = request.params;

    const order = repo.findOrderByInvoiceId(invoiceId);
    if (!order) {
      return reply.status(404).type('text/html').send(`
        <!DOCTYPE html>
        <html><head><title>Não encontrado</title></head>
        <body><h1>Pedido não encontrado</h1><a href="/admin">Voltar</a></body></html>
      `);
    }

    const items = repo.getOrderItems(order.id);
    const events = repo.getEventsByOrderId(order.id, 50);

    const html = renderOrderPage(order, items, events);
    return reply.type('text/html').send(html);
  });

  /**
   * POST /admin/order/:invoiceId/reprocess
   * Reprocessa um pedido com falha
   */
  fastify.post('/admin/order/:invoiceId/reprocess', async (
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply
  ) => {
    const { invoiceId } = request.params;
    const log = createOrderLogger(invoiceId);

    const order = repo.findOrderByInvoiceId(invoiceId);
    if (!order) {
      return reply.status(404).send({ error: 'Pedido não encontrado' });
    }

    log.info('Reprocessando pedido manualmente');

    // Resetar status e limpar erro
    repo.updateOrderStatus(invoiceId, 'NOVO', {
      errorMessage: null,
      loggiShipmentId: undefined,
      loggiTrackingCode: undefined,
    });

    // Criar evento
    repo.createEvent('order_reprocess_manual', {}, order.id, invoiceId);

    // Enfileirar
    enqueueCreateShipment(invoiceId);

    return reply.redirect(`/admin/order/${invoiceId}`);
  });

  /**
   * POST /admin/order/:invoiceId/mark-posted
   * Marca pedido como postado
   */
  fastify.post('/admin/order/:invoiceId/mark-posted', async (
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply
  ) => {
    const { invoiceId } = request.params;
    const log = createOrderLogger(invoiceId);

    const order = repo.findOrderByInvoiceId(invoiceId);
    if (!order) {
      return reply.status(404).send({ error: 'Pedido não encontrado' });
    }

    log.info('Marcando pedido como postado');

    repo.updateOrderStatus(invoiceId, 'POSTADO');
    repo.createEvent('order_marked_posted', {}, order.id, invoiceId);

    return reply.redirect(`/admin/order/${invoiceId}`);
  });

  /**
   * GET /labels/:invoiceId
   * Serve o PDF da etiqueta
   */
  fastify.get('/labels/:invoiceId', async (
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply
  ) => {
    const { invoiceId } = request.params;

    const order = repo.findOrderByInvoiceId(invoiceId);
    if (!order || !order.label_path) {
      return reply.status(404).send({ error: 'Etiqueta não encontrada' });
    }

    const labelPath = join(process.cwd(), order.label_path);
    if (!existsSync(labelPath)) {
      logger.error({ labelPath }, 'Arquivo de etiqueta não encontrado no disco');
      return reply.status(404).send({ error: 'Arquivo de etiqueta não encontrado' });
    }

    const pdf = readFileSync(labelPath);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${invoiceId}.pdf"`)
      .send(pdf);
  });

  /**
   * GET /api/orders
   * API JSON para listar pedidos
   */
  fastify.get('/api/orders', async (request: FastifyRequest, reply: FastifyReply) => {
    const orders = repo.getAllOrders(100);
    return reply.send({ orders });
  });

  /**
   * GET /api/orders/:invoiceId
   * API JSON para detalhes de um pedido
   */
  fastify.get('/api/orders/:invoiceId', async (
    request: FastifyRequest<{ Params: { invoiceId: string } }>,
    reply: FastifyReply
  ) => {
    const { invoiceId } = request.params;

    const order = repo.findOrderByInvoiceId(invoiceId);
    if (!order) {
      return reply.status(404).send({ error: 'Pedido não encontrado' });
    }

    const items = repo.getOrderItems(order.id);
    const events = repo.getEventsByOrderId(order.id, 50);

    return reply.send({ order, items, events });
  });
}
