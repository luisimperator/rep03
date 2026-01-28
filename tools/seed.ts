/**
 * Script para popular o banco com dados de exemplo
 *
 * Uso: npx tsx tools/seed.ts
 */

import { config } from 'dotenv';
config();

import { runMigrations } from '../src/db/migrate.js';
import * as repo from '../src/db/repo.js';
import type { ParsedEduzzData, OrderStatus } from '../src/types.js';

console.log('='.repeat(60));
console.log('Seed - Populando banco com dados de exemplo');
console.log('='.repeat(60));

// Rodar migrações primeiro
runMigrations();

// Dados de exemplo
const sampleOrders: Array<{
  data: ParsedEduzzData;
  status: OrderStatus;
  loggiShipmentId?: string;
  loggiTrackingCode?: string;
  labelPath?: string;
  errorMessage?: string;
}> = [
  {
    data: {
      invoiceId: 'SEED-001',
      buyer: {
        name: 'Maria Santos',
        email: 'maria.santos@email.com',
        phone: '11988776655',
      },
      address: {
        street: 'Av. Paulista',
        number: '1000',
        complement: 'Sala 501',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310100',
        country: 'BR',
      },
      items: [
        {
          productId: '12345',
          name: 'Pack Adesivos Premium',
          skuReference: 'ADESIVO-01',
          quantity: 1,
          price: 29.90,
        },
      ],
      paidAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 dias atrás
      transactionId: 'TXN-001',
    },
    status: 'ETIQUETA_GERADA',
    loggiShipmentId: 'LOGGI-SHIP-001',
    loggiTrackingCode: 'TRACK001BR',
    labelPath: 'data/labels/SEED-001.pdf',
  },
  {
    data: {
      invoiceId: 'SEED-002',
      buyer: {
        name: 'João Pereira',
        email: 'joao.pereira@email.com',
        phone: '21999887766',
      },
      address: {
        street: 'Rua Copacabana',
        number: '500',
        complement: null,
        neighborhood: 'Copacabana',
        city: 'Rio de Janeiro',
        state: 'RJ',
        zipCode: '22041080',
        country: 'BR',
      },
      items: [
        {
          productId: '67890',
          name: 'Adesivo Especial Edição Limitada',
          skuReference: 'ADESIVO-02',
          quantity: 3,
          price: 49.90,
        },
      ],
      paidAt: new Date(Date.now() - 86400000).toISOString(), // 1 dia atrás
      transactionId: 'TXN-002',
    },
    status: 'AGUARDANDO_LOGGI',
    loggiShipmentId: 'LOGGI-SHIP-002',
  },
  {
    data: {
      invoiceId: 'SEED-003',
      buyer: {
        name: 'Ana Costa',
        email: 'ana.costa@email.com',
        phone: '31988665544',
      },
      address: {
        street: 'Rua da Bahia',
        number: '1500',
        complement: 'Loja 2',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        zipCode: '30160011',
        country: 'BR',
      },
      items: [
        {
          productId: '12345',
          name: 'Pack Adesivos Premium',
          skuReference: 'ADESIVO-01',
          quantity: 2,
          price: 29.90,
        },
        {
          productId: '67890',
          name: 'Adesivo Especial',
          skuReference: 'ADESIVO-02',
          quantity: 1,
          price: 49.90,
        },
      ],
      paidAt: new Date(Date.now() - 3600000).toISOString(), // 1 hora atrás
      transactionId: 'TXN-003',
    },
    status: 'NOVO',
  },
  {
    data: {
      invoiceId: 'SEED-004',
      buyer: {
        name: 'Carlos Lima',
        email: 'carlos.lima@email.com',
        phone: '41977553322',
      },
      address: {
        street: 'Rua XV de Novembro',
        number: '700',
        complement: null,
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'PR',
        zipCode: '80020310',
        country: 'BR',
      },
      items: [
        {
          productId: '12345',
          name: 'Pack Adesivos Premium',
          skuReference: 'ADESIVO-01',
          quantity: 1,
          price: 29.90,
        },
      ],
      paidAt: new Date(Date.now() - 86400000 * 3).toISOString(), // 3 dias atrás
      transactionId: 'TXN-004',
    },
    status: 'FALHA',
    errorMessage: 'CEP inválido ou não atendido pela Loggi',
  },
  {
    data: {
      invoiceId: 'SEED-005',
      buyer: {
        name: 'Fernanda Oliveira',
        email: 'fernanda.oliveira@email.com',
        phone: '51966443322',
      },
      address: {
        street: 'Av. Borges de Medeiros',
        number: '2500',
        complement: 'Apto 1201',
        neighborhood: 'Praia de Belas',
        city: 'Porto Alegre',
        state: 'RS',
        zipCode: '90110150',
        country: 'BR',
      },
      items: [
        {
          productId: '67890',
          name: 'Adesivo Especial Edição Limitada',
          skuReference: 'ADESIVO-02',
          quantity: 5,
          price: 49.90,
        },
      ],
      paidAt: new Date(Date.now() - 86400000 * 5).toISOString(), // 5 dias atrás
      transactionId: 'TXN-005',
    },
    status: 'POSTADO',
    loggiShipmentId: 'LOGGI-SHIP-005',
    loggiTrackingCode: 'TRACK005BR',
    labelPath: 'data/labels/SEED-005.pdf',
  },
];

// Inserir pedidos
console.log('\nInserindo pedidos de exemplo...\n');

for (const sample of sampleOrders) {
  // Verificar se já existe
  const existing = repo.findOrderByInvoiceId(sample.data.invoiceId);
  if (existing) {
    console.log(`⏭️  Pedido ${sample.data.invoiceId} já existe, pulando`);
    continue;
  }

  // Criar pedido
  const order = repo.createOrderWithItems(sample.data);

  // Atualizar status e dados extras
  repo.updateOrderStatus(sample.data.invoiceId, sample.status, {
    loggiShipmentId: sample.loggiShipmentId,
    loggiTrackingCode: sample.loggiTrackingCode,
    labelPath: sample.labelPath,
    errorMessage: sample.errorMessage ?? null,
  });

  // Criar evento de seed
  repo.createEvent('seed_created', {
    status: sample.status,
  }, order.id, sample.data.invoiceId);

  console.log(`✅ Pedido ${sample.data.invoiceId} criado`);
  console.log(`   Comprador: ${sample.data.buyer.name}`);
  console.log(`   Cidade: ${sample.data.address.city}/${sample.data.address.state}`);
  console.log(`   Status: ${sample.status}`);
  console.log('');
}

console.log('='.repeat(60));
console.log('Seed concluído!');
console.log('');
console.log('Estatísticas:');
const counts = repo.countOrdersByStatus();
for (const [status, count] of Object.entries(counts)) {
  if (count > 0) {
    console.log(`  ${status}: ${count}`);
  }
}
console.log('');
console.log('Acesse o painel: http://localhost:3000/admin');
console.log('='.repeat(60));
