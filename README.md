# Eduzz → Loggi Automation

Sistema de automação para envio de adesivos. Quando uma venda é paga na Eduzz, o sistema automaticamente cria um envio na Loggi e gera a etiqueta.

## Funcionalidades

- **Webhook Eduzz**: Recebe notificações de vendas pagas (`myeduzz.invoice_paid`)
- **Validação HMAC-SHA256**: Valida autenticidade dos webhooks
- **Filtro de produtos**: Processa apenas produtos físicos (adesivos) da allowlist
- **Integração Loggi**: Cria shipments e gera etiquetas PDF automaticamente
- **Painel Admin**: Interface web para gerenciar pedidos, baixar etiquetas e reprocessar falhas
- **Fila de jobs**: Processamento assíncrono com retry automático
- **Logs estruturados**: Auditoria completa com correlação por pedido

## Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify 5
- **Linguagem**: TypeScript
- **Banco de dados**: SQLite (better-sqlite3)
- **Logs**: Pino
- **UI**: HTML + Tailwind CSS (via CDN)

## Instalação

### 1. Clonar e instalar dependências

```bash
git clone <repo-url>
cd eduzz-loggi-automation
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
# Servidor
APP_PORT=3000

# Eduzz
EDUZZ_WEBHOOK_SECRET=sua_chave_secreta_aqui
EDUZZ_ALLOWED_PRODUCT_IDS=12345,67890
EDUZZ_ALLOWED_SKUS=ADESIVO-01,ADESIVO-02

# Loggi
LOGGI_BASE_URL=https://api.loggi.com
LOGGI_CLIENT_ID=seu_client_id
LOGGI_CLIENT_SECRET=seu_client_secret
LOGGI_COMPANY_ID=seu_company_id

# Endereço de origem (remetente)
ORIGIN_NAME=Sua Empresa
ORIGIN_PHONE=11999999999
ORIGIN_EMAIL=contato@suaempresa.com
ORIGIN_STREET=Rua Exemplo
ORIGIN_NUMBER=100
ORIGIN_COMPLEMENT=Sala 1
ORIGIN_NEIGHBORHOOD=Centro
ORIGIN_CITY=São Paulo
ORIGIN_STATE=SP
ORIGIN_ZIP=01000000

# Pacote padrão
PACKAGE_WEIGHT_G=50
PACKAGE_LENGTH_CM=12
PACKAGE_WIDTH_CM=7
PACKAGE_HEIGHT_CM=1
```

### 3. Rodar migrações e iniciar

```bash
# Desenvolvimento
npm run dev

# Ou produção
npm run build
npm start
```

O servidor estará disponível em `http://localhost:3000`

## Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/admin` | Painel administrativo |
| GET | `/admin/order/:invoiceId` | Detalhes do pedido |
| POST | `/admin/order/:invoiceId/reprocess` | Reprocessar pedido com falha |
| POST | `/admin/order/:invoiceId/mark-posted` | Marcar como postado |
| GET | `/labels/:invoiceId` | Download da etiqueta PDF |
| POST | `/webhooks/eduzz` | Webhook Eduzz |
| POST | `/webhooks/loggi` | Webhook Loggi |
| GET | `/health` | Health check |
| GET | `/api/orders` | API JSON - listar pedidos |
| GET | `/api/orders/:invoiceId` | API JSON - detalhes do pedido |

## Expor webhooks (desenvolvimento)

Para receber webhooks em ambiente local, use ngrok ou cloudflared:

### Opção A: ngrok

```bash
# Instalar ngrok
npm install -g ngrok

# Expor porta 3000
ngrok http 3000
```

### Opção B: cloudflared

```bash
# Instalar cloudflared
# macOS: brew install cloudflared
# Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation

# Expor porta 3000
cloudflared tunnel --url http://localhost:3000
```

Copie a URL pública (ex: `https://abc123.ngrok.io`) para configurar os webhooks.

## Configurar Webhooks

### Eduzz

1. Acesse o painel Eduzz → Integrações → Webhooks
2. Adicione novo webhook:
   - **URL**: `https://sua-url-publica.ngrok.io/webhooks/eduzz`
   - **Eventos**: `myeduzz.invoice_paid`
3. Copie o **Webhook Secret** e configure no `.env` como `EDUZZ_WEBHOOK_SECRET`

### Loggi (opcional)

Se a API Loggi suportar webhooks para status de shipment:

1. Configure a URL: `https://sua-url-publica.ngrok.io/webhooks/loggi`
2. Eventos: `shipment.created`, `shipment.ready`, etc.

## Testar localmente

### Enviar webhook de teste

```bash
# Com servidor rodando em localhost:3000
npm run test:webhook

# Ou especificando URL
npx tsx tools/send-test-webhook.ts https://sua-url.ngrok.io
```

### Popular banco com dados de exemplo

```bash
npm run seed
```

Isso cria 5 pedidos de exemplo em diferentes estados para testar a UI.

## Estrutura do Projeto

```
├── src/
│   ├── server.ts           # Servidor Fastify principal
│   ├── config.ts           # Carregamento de configurações
│   ├── types.ts            # Definições de tipos TypeScript
│   ├── routes/
│   │   ├── admin.ts        # Rotas do painel admin
│   │   ├── webhooks-eduzz.ts
│   │   └── webhooks-loggi.ts
│   ├── services/
│   │   ├── eduzz.ts        # Validação e parsing webhook Eduzz
│   │   └── loggi.ts        # Cliente API Loggi
│   ├── db/
│   │   ├── connection.ts   # Conexão SQLite
│   │   ├── migrate.ts      # Migrações
│   │   ├── repo.ts         # Repositório de dados
│   │   └── schema.sql      # Schema do banco
│   ├── jobs/
│   │   ├── queue.ts        # Fila de processamento
│   │   └── handlers.ts     # Handlers dos jobs
│   └── utils/
│       ├── crypto.ts       # HMAC e validação de assinatura
│       ├── logger.ts       # Logger Pino
│       └── validators.ts   # Sanitização de dados
├── tools/
│   ├── send-test-webhook.ts
│   └── seed.ts
├── data/
│   ├── database.db         # Banco SQLite (gitignored)
│   └── labels/             # PDFs de etiquetas (gitignored)
├── .env.example
├── package.json
└── tsconfig.json
```

## Fluxo de Processamento

```
1. Eduzz envia webhook (invoice_paid)
   ↓
2. Validar assinatura HMAC-SHA256
   ↓
3. Verificar se produto está na allowlist
   ↓
4. Salvar pedido no banco (status: NOVO)
   ↓
5. Enfileirar job: CREATE_SHIPMENT
   ↓
6. Job: Criar shipment na Loggi (status: ENVIANDO → AGUARDANDO_LOGGI)
   ↓
7. Enfileirar job: GENERATE_LABEL
   ↓
8. Job: Gerar etiqueta PDF (status: ETIQUETA_GERADA)
   ↓
9. Operador: Baixar etiqueta, imprimir, postar
   ↓
10. Operador: Marcar como POSTADO no painel
```

## Status dos Pedidos

| Status | Descrição |
|--------|-----------|
| `NOVO` | Pedido recebido, aguardando processamento |
| `ENVIANDO` | Criando shipment na Loggi |
| `AGUARDANDO_LOGGI` | Shipment criado, aguardando confirmação/etiqueta |
| `ETIQUETA_GERADA` | Etiqueta PDF disponível para download |
| `FALHA` | Erro no processamento (pode reprocessar) |
| `POSTADO` | Pedido foi postado nos Correios/Loggi |

## Tratamento de Erros

- **Erros transitórios** (5xx, timeout): Retry automático com backoff (1min, 5min, 15min, 30min, 60min)
- **Erros permanentes** (4xx): Pedido marcado como FALHA, requer intervenção manual
- **Webhook inválido**: Responde 200 para não travar fila da Eduzz

## Logs

Logs estruturados com correlationId (invoiceId) para rastreamento:

```bash
# Ver logs em tempo real (dev)
npm run dev

# Logs em JSON (produção)
NODE_ENV=production npm start | npx pino-pretty
```

## Produção

### Variáveis de ambiente importantes

```env
NODE_ENV=production
LOG_LEVEL=info
```

### Docker (exemplo)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY src/db/schema.sql ./dist/db/
RUN mkdir -p data/labels
CMD ["node", "dist/server.js"]
```

### Persistência

Certifique-se de montar o diretório `data/` como volume para persistir:
- Banco de dados SQLite
- Etiquetas PDF

## Licença

MIT
