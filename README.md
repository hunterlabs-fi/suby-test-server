# Suby.fi Test Server

Simple Express + TypeScript server for testing Suby.fi webhook reception, payment intent creation, and product creation.

## Features

- Webhook endpoint with signature verification (HMAC-SHA256)
- Payment intent creation via Suby.fi API
- Product creation via Suby.fi Merchant API
- TypeScript with strict type checking
- Environment variable configuration
- Proper error handling and logging

## Installation

```bash
npm install
```

## Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Edit `.env` and add your credentials:

```env
PORT=3000
WEBHOOK_SECRET=your_webhook_secret_here
SUBY_API_KEY=sk_live_your_api_key_here
SUBY_API_URL=https://api.suby.fi/api
```

## Running the Server

### Development Mode (with hot reload)

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status.

### Webhook Receiver

```bash
POST /webhooks
```

Receives and verifies signed webhooks from Suby.fi. The endpoint:
- Validates HMAC-SHA256 signature
- Checks timestamp (must be < 5 minutes old)
- Logs webhook events to console
- Returns 200 OK on success

Webhook events:

| Event | Description | Use case |
|-------|-------------|----------|
| `CHECKOUT_INITIATED` | Customer starts the payment process | Track checkout conversions, send analytics |
| `CHECKOUT_SUCCESS` | Successful card checkout and payment authorization. **Card payments only**, never sent for crypto | Grant access for card payments, update order status, send confirmation emails |
| `TX_SUCCESS` | Crypto payment confirmed on-chain — funds are transferred instantly. **Crypto payments only** | Grant access for crypto payments, update order status |
| `PAYMENT_SUCCESS` | Payment authorized by provider or confirmed on-chain. For card payments, final settlement may occur later | For crypto: also triggers `TX_SUCCESS`. For card: access should already be granted at `CHECKOUT_SUCCESS` |
| `PAYMENT_FAILED` | Payment failed after processing. Crypto: on-chain failure. Card: may occur during settlement (can happen after `CHECKOUT_SUCCESS`) | Notify customer, handle retries/fallback flows, update order status |
| `PAYMENT_REFUNDED` | Card payment has been refunded | Revoke access, update order status, notify customer |

Each webhook payload includes comprehensive payment and customer information:
- Payment details (ID, status, amount, transaction hash)
- Customer identification (email, Discord ID/username, Telegram ID/username)
- Context data (external reference, metadata, redirect URLs)

### Create Payment Intent

```bash
POST /payment/create
Content-Type: application/json

{
  "planId": "plan_456def",
  "customerEmail": "customer@example.com",
  "externalRef": "order_789xyz",
  "metadata": {
    "orderId": "12345",
    "source": "mobile_app"
  },
  "successUrl": "https://your-app.com/success",
  "cancelUrl": "https://your-app.com/cancel"
}
```

Creates a payment intent on Suby.fi and returns:

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_abc123xyz",
    "paymentUrl": "https://app.suby.fi/pay/pay_abc123xyz",
    "metadata": {
      "orderId": "12345",
      "source": "mobile_app"
    }
  }
}
```

### Create Product

```bash
POST /product/create
Content-Type: application/json

{
  "name": "Premium Access",
  "description": "Monthly premium membership",
  "frequencyInDays": 30,
  "priceCents": "999",
  "currency": "EUR",
  "platform": "WEB",
  "paymentMethods": ["CRYPTO", "CARD"],
  "acceptedAssets": ["USDC", "USDT"],
  "acceptedChains": [8453, 42161],
  "supply": 100,
  "imageUrl": "https://example.com/product.png"
}
```

Creates a product on Suby.fi via the Merchant API. The request is proxied to the Suby API using your API key.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Product name (1-100 chars) |
| `description` | string | No | Description (max 500 chars) |
| `frequencyInDays` | number\|null | No | Billing frequency in days (e.g. `30` for monthly). `null` = one-time purchase |
| `priceCents` | string | Yes | Price in cents (`"999"` = 9.99 in the currency) |
| `currency` | string | Yes | `USD` or `EUR` |
| `platform` | string | No | `DISCORD`, `TELEGRAM`, `WEB`, `INVOICE`. Defaults to `WEB` |
| `paymentMethods` | string[] | Yes | `CRYPTO` (wallet connect + QR code) and/or `CARD` (credit/debit card) |
| `acceptedAssets` | string[] | No | Token symbols to accept (e.g. `["USDC", "ETH"]`). If omitted, all active assets are enabled |
| `acceptedChains` | number[] | No | Chain IDs to accept (e.g. `[8453, 42161]`). If omitted, all active chains are enabled |
| `supply` | number | No | Max subscriptions allowed (min 1). `null` = unlimited |
| `imageUrl` | string | No | Direct URL to product image |
| `discordGuildId` | string | DISCORD only | Discord server (guild) ID. **Required** when `platform` is `DISCORD` |
| `discordRoleId` | string | DISCORD only | Discord role ID to grant subscribers. **Required** when `platform` is `DISCORD` |
| `discordRemindersId` | string | No | Discord channel ID for renewal reminders. Only used with `DISCORD` platform |
| `telegramGroupId` | string | TELEGRAM only | Telegram group/channel ID. **Required** when `platform` is `TELEGRAM` |

**Payment Method Requirements:**

| Method | Requirements |
|--------|-------------|
| `CRYPTO` | Merchant must have a receiving address configured (`merchantAddressEVM` for EVM chains, `merchantAddressSOL` for Solana) |
| `CARD` | Merchant must have completed verification. Minimum price: 200 cents (2.00 USD/EUR). Requires a payout address |

**Response:**

The response shape adapts based on the product's platform. Fields irrelevant to the platform are excluded.

```json
{
  "success": true,
  "data": {
    "id": "clx_abc123",
    "name": "Premium Access",
    "description": "Monthly premium membership",
    "status": "ACTIVE",
    "platform": "WEB",
    "frequencyInDays": 30,
    "priceUsd": null,
    "priceEur": "999",
    "supply": 100,
    "imageUrl": "https://example.com/product.png",
    "createdAt": "2026-03-20T10:30:00.000Z",
    "paymentMethods": ["CRYPTO", "CARD"],
    "acceptedAssets": [
      { "symbol": "USDC", "decimals": 6 },
      { "symbol": "USDT", "decimals": 6 }
    ],
    "acceptedChains": [
      { "id": 8453, "name": "Base" },
      { "id": 42161, "name": "Arbitrum" }
    ]
  }
}
```

For **DISCORD** platform, the response also includes:

```json
{
  "discordGuildId": "123456789012345678",
  "discordRoleId": "987654321098765432",
  "discordRemindersId": "111222333444555666"
}
```

For **TELEGRAM** platform, the response also includes:

```json
{
  "telegramGroupId": "-1001234567890"
}
```

**Notes:**
- `supply` limits the total number of subscriptions (checked on first purchase only, not renewals)
- EUR pricing: Card payments use EUR. Crypto payments are converted via EUR/USD Pyth oracle rate
- Status is `ACTIVE` for DISCORD/WEB/INVOICE, `PENDING` for TELEGRAM
- Assets are automatically resolved across all accepted chains (e.g. `"USDC"` adds USDC on Base, Arbitrum, etc.)

### List Customers

```bash
GET /customer?page=1&limit=25
```

Returns a paginated list of customers who have at least one successful payment on your products.

**Query Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Results per page, max 25 (default: 25) |

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "clx_abc123",
        "email": "customer@example.com",
        "name": "John Doe",
        "totalPayments": 5,
        "createdAt": "2026-01-15T10:30:00.000Z",
        "updatedAt": "2026-03-01T14:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 42,
      "totalPages": 2
    }
  }
}
```

**Notes:**
- Only customers who have payments on your products are returned
- Payment history only includes payments made on your products (not other merchants)

## Testing Webhooks Locally

To test webhooks on your local machine, you need to expose your server to the internet. Use one of these tools:

### Using ngrok

```bash
# Install ngrok (if not already installed)
brew install ngrok  # macOS
# or download from https://ngrok.com/

# Start your server
npm run dev

# In another terminal, expose port 3000
ngrok http 3000
```

This will give you a public URL like `https://abc123.ngrok.io`. Configure this as your webhook URL in Suby.fi:

```
https://abc123.ngrok.io/webhooks
```

## Example Usage

### Creating a Payment

```bash
curl -X POST http://localhost:3000/payment/create \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "plan_456def",
    "customerEmail": "test@example.com",
    "externalRef": "order_123",
    "metadata": {
      "userId": "user_456"
    },
    "successUrl": "https://your-app.com/success",
    "cancelUrl": "https://your-app.com/cancel"
  }'
```

### Creating a Product

```bash
curl -X POST http://localhost:3000/product/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Premium Access",
    "description": "Monthly premium membership",
    "frequencyInDays": 30,
    "priceCents": "999",
    "currency": "EUR",
    "platform": "WEB",
    "paymentMethods": ["CRYPTO"],
    "acceptedAssets": ["USDC"],
    "acceptedChains": [8453]
  }'
```

### Simulating a Webhook (for testing)

```bash
# Generate signature with complete payload including customer fields
TIMESTAMP=$(date +%s)
BODY='{"id":"evt_test123","type":"PAYMENT_SUCCESS","createdAt":"2026-02-05T10:30:00.000Z","data":{"payment":{"id":"pay_abc123xyz","status":"SUCCESS","subscriptionId":"sub_xyz789","productId":"product_456def","valueUsd":"999","txHash":"0x1234567890abcdef...","source":"CRYPTO","customerEmail":"customer@example.com","customerDiscordId":"123456789012345678","customerTelegramId":null,"customerDiscordUsername":"user#1234","customerTelegramUsername":null},"context":{"externalRef":"order_789xyz","metadata":{"orderId":"12345","source":"mobile_app"},"successUrl":"https://your-app.com/success","cancelUrl":"https://your-app.com/cancel"}}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "your_webhook_secret_here" | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: PAYMENT_SUCCESS" \
  -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
  -H "X-Webhook-Signature: v1=${SIGNATURE}" \
  -d "${BODY}"
```

**Webhook Payload Structure:**

The webhook includes comprehensive payment and customer information:

```typescript
interface WebhookEvent {
  id: string;                    // Unique event ID (evt_xxx format)
  type: string;                  // Event type (PAYMENT_SUCCESS, PAYMENT_FAILED, etc.)
  createdAt: string;             // ISO 8601 timestamp
  data: {
    payment: {
      id: string;                // Payment ID
      status: string;            // Payment status
      subscriptionId: string | null;
      productId: string | null;
      valueUsd: string | null;   // Amount in cents
      txHash: string | null;     // Blockchain transaction hash (crypto only)
      source: string | null;     // "CRYPTO" or "FIAT"

      // Customer identification fields
      customerEmail: string | null;
      customerDiscordId: string | null;
      customerTelegramId: string | null;
      customerDiscordUsername: string | null;
      customerTelegramUsername: string | null;
    };
    context: {
      externalRef: string | null;       // Your internal reference
      metadata: Record<string, any> | null;  // Custom metadata
      successUrl: string | null;
      cancelUrl: string | null;
    };
  };
}
```

## Security Features

- HMAC-SHA256 signature verification for webhooks
- Timestamp validation (rejects webhooks > 5 minutes old)
- Raw body preservation for signature verification
- X-Suby-Api-Key token authentication for API calls

## Project Structure

```
.
├── src/
│   └── index.ts          # Main server file
├── dist/                 # Compiled JavaScript (generated)
├── .env.example          # Example environment variables
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## Development

### Type Checking

```bash
npm run type-check
```

### Build

```bash
npm run build
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `WEBHOOK_SECRET` | Yes | Webhook signature verification secret |
| `SUBY_API_KEY` | Yes | API key for Suby.fi (format: sk_live_xxx) |
| `SUBY_API_URL` | No | Suby.fi API base URL (default: https://api.suby.fi/api) |
