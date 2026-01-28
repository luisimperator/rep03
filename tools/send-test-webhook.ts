/**
 * Script para enviar webhook de teste simulando Eduzz
 *
 * Uso:
 *   npx tsx tools/send-test-webhook.ts
 *   npx tsx tools/send-test-webhook.ts http://localhost:3000
 *   npx tsx tools/send-test-webhook.ts https://seu-dominio.ngrok.io
 */

import { createHmac } from 'crypto';
import { config } from 'dotenv';

config();

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.EDUZZ_WEBHOOK_SECRET || 'dev_secret_change_me';

// Gerar invoice ID único
const invoiceId = `TEST-${Date.now()}`;

// Payload de exemplo simulando webhook Eduzz
const payload = {
  event: 'myeduzz.invoice_paid',
  data: {
    id: invoiceId,
    buyer: {
      name: 'João da Silva',
      email: 'joao.silva@exemplo.com',
      phone: '11999887766',
      cellphone: '11999887766',
    },
    address: {
      street: 'Rua das Palmeiras',
      number: '456',
      complement: 'Apto 12',
      neighborhood: 'Jardim Primavera',
      city: 'São Paulo',
      state: 'SP',
      zipCode: '01234-567',
      country: 'BR',
    },
    items: [
      {
        productId: '12345',
        name: 'Pack de Adesivos Premium',
        skuReference: 'ADESIVO-01',
        qty: 2,
        price: 29.90,
      },
    ],
    paid_at: new Date().toISOString(),
    transaction: {
      id: `TXN-${Date.now()}`,
      key: `KEY-${Date.now()}`,
    },
  },
};

// Converter para JSON
const body = JSON.stringify(payload);

// Gerar assinatura HMAC-SHA256
const signature = createHmac('sha256', WEBHOOK_SECRET)
  .update(body)
  .digest('hex');

console.log('='.repeat(60));
console.log('Eduzz Webhook Test Tool');
console.log('='.repeat(60));
console.log(`URL: ${BASE_URL}/webhooks/eduzz`);
console.log(`Invoice ID: ${invoiceId}`);
console.log(`Secret: ${WEBHOOK_SECRET.slice(0, 4)}...${WEBHOOK_SECRET.slice(-4)}`);
console.log(`Signature: ${signature.slice(0, 16)}...`);
console.log('='.repeat(60));

async function sendWebhook() {
  try {
    console.log('\nEnviando webhook...\n');

    const response = await fetch(`${BASE_URL}/webhooks/eduzz`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature,
      },
      body,
    });

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = responseText;
    }

    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log('Response:', JSON.stringify(responseJson, null, 2));

    if (response.status === 201) {
      console.log('\n✅ Webhook processado com sucesso!');
      console.log(`\nAcesse o painel: ${BASE_URL}/admin`);
      console.log(`Detalhes do pedido: ${BASE_URL}/admin/order/${invoiceId}`);
    } else if (response.status === 200) {
      console.log('\n⚠️  Webhook recebido (possível duplicata ou ignorado)');
    } else {
      console.log('\n❌ Erro ao processar webhook');
    }

  } catch (error) {
    console.error('\n❌ Erro ao enviar webhook:');
    console.error(error instanceof Error ? error.message : error);
    console.log('\nVerifique se o servidor está rodando.');
  }
}

sendWebhook();
