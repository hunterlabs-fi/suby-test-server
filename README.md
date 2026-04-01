# Suby.fi Test Server

Simple Express + TypeScript server for testing Suby.fi webhook reception and payment intent creation.

## Features

- Webhook endpoint with signature verification (HMAC-SHA256)
- Payment intent creation via Suby.fi API
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
SUBY_API_URL=https://api.suby.fi
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

**Payment events:**
- `CHECKOUT_INITIATED` - Payment checkout initiated
- `CHECKOUT_SUCCESS` - Checkout completed (card authorized / crypto transaction confirmed)
- `PAYMENT_SUCCESS` - Payment successful (fiat settlement completed)
- `PAYMENT_FAILED` - Payment failed
- `PAYMENT_REFUNDED` - Card payment has been refunded

**Subscription events:**
- `SUBSCRIPTION_PAST_DUE` - Subscription renewal payment is overdue
- `SUBSCRIPTION_EXPIRED` - Subscription has expired (access removed)

Each webhook includes these headers:
- `X-Webhook-Event` — the event type
- `X-Webhook-Timestamp` — Unix timestamp
- `X-Webhook-Signature` — `v1={hmac_hex}`

Payment webhook payload includes:
- Payment details (ID, status, amount, transaction hash, custom price, VAT)
- Customer identification (email, Discord ID/username, Telegram ID/username)
- Context data (external reference, metadata, redirect URLs)

Subscription webhook payload includes:
- Subscription details (ID, status, productId, expiresAt)
- Last payment info (ID, status, priceCents, currency)
- Customer identification (email, Discord/Telegram IDs)
- Context data (external reference, metadata)

### Create One-Time Payment

```bash
POST /payment/create
Content-Type: application/json

{
  "productId": "pro_456def",
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

Creates a one-time payment and returns:

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_abc123xyz",
    "paymentUrl": "https://checkout.suby.fi/pay/pay_abc123xyz",
    "metadata": {
      "orderId": "12345",
      "source": "mobile_app"
    }
  }
}
```

> For **custom price** products (`isCustomPrice: true`), include `priceCents` and `currency`:
> ```json
> {
>   "productId": "pro_456def",
>   "customerEmail": "customer@example.com",
>   "priceCents": "2500",
>   "currency": "USD"
> }
> ```

### Create Subscription Payment

```bash
POST /subscription/create
Content-Type: application/json

{
  "productId": "pro_sub789",
  "customerEmail": "customer@example.com",
  "externalRef": "sub_ref_001",
  "successUrl": "https://your-app.com/success",
  "cancelUrl": "https://your-app.com/cancel"
}
```

Creates a subscription payment for a recurring product and returns:

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_sub789",
    "paymentUrl": "https://checkout.suby.fi/sub/pay_sub789",
    "metadata": null
  }
}
```

### Create Product

```bash
POST /product/create
Content-Type: application/json
```

Creates a product on Suby.fi via the Merchant API. The request is proxied to the Suby API using your API key.

**Request Body:**

```json
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

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Product name (1-100 characters) |
| `description` | string | No | Product description (max 500 characters) |
| `frequencyInDays` | number\|null | No | Billing frequency in days (e.g. `30` for monthly). `null` or omitted = one-time purchase |
| `isCustomPrice` | boolean | No | Set to `true` for dynamic pricing. When enabled, `priceCents` must not be set on the product — it is provided per-payment instead |
| `priceCents` | string | Conditional | Price in cents as a string. **Required** when `isCustomPrice` is `false` (default). **Must NOT be provided** when `isCustomPrice` is `true`. Must be a positive integer |
| `currency` | string | Conditional | Price currency: `"USD"` or `"EUR"`. **Required** when `isCustomPrice` is `false` (default). **Must NOT be provided** when `isCustomPrice` is `true` |
| `platform` | string | No | Target platform: `"WEB"` or `"INVOICE"`. Defaults to `"WEB"` |
| `paymentMethods` | string[] | Yes | Payment methods to enable: `"CRYPTO"` (wallet connect + QR code) and/or `"CARD"` (credit/debit card via Inflow). At least one required |
| `acceptedAssets` | string[] | No | Token symbols to accept (e.g. `["USDC", "ETH"]`). Applied across all accepted chains. If omitted, all active assets on accepted chains are enabled |
| `acceptedChains` | number[] | No | Chain IDs to accept (e.g. `[8453, 42161, 101]`). If omitted, all active chains are enabled. Chains without matching assets are automatically excluded |
| `supply` | number | No | Maximum number of subscriptions allowed (minimum 1). If omitted, defaults to unlimited |
| `imageUrl` | string | No | Direct URL to a product image |

**Payment Method Requirements:**

| Method | Requirements |
|--------|-------------|
| `CRYPTO` | Merchant must have a receiving address configured: `merchantAddressEVM` for EVM chains, `merchantAddressSOL` for Solana. Only the addresses matching the selected chains are required |
| `CARD` | Merchant must have completed verification (auto-debit approval). Minimum price: 200 cents (2.00 USD/EUR). Merchant must have a payout address configured (`merchantPayoutAddressEVM` or `merchantPayoutAddressSOL`) |

**Response:**

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
    "isCustomPrice": false,
    "priceCents": "999",
    "currency": "EUR",
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

### Update Product

```bash
PATCH /product/:productId
Content-Type: application/json
```

Updates specific fields of an existing product. All fields are optional — only include the ones you want to change.

**Request Body:**

```json
{
  "status": "CANCELLED",
  "priceCents": "1499",
  "frequencyInDays": 30,
  "supply": 200
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Set to `"ACTIVE"` or `"CANCELLED"`. Can only toggle between these two statuses |
| `priceCents` | string | No | New price in cents. Cannot be changed for recurring card (AUTO_DEBIT) subscriptions. One-time products can always be updated. Minimum 200 cents if product has card payments |
| `frequencyInDays` | number\|null | No | New billing frequency. Cannot be changed for products with card (AUTO_DEBIT) payments. Set to `null` to convert to one-time |
| `supply` | number | No | New maximum subscriptions (minimum 1) |

**Example:**

```bash
curl -X PATCH http://localhost:3000/product/clx_abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "priceCents": "1499",
    "supply": 200
  }'
```

### Cancel Subscription

```bash
DELETE /subscription/:subscriptionId
```

Cancels an active subscription. If the subscription was paid via card (Inflow), the recurring billing is also cancelled.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "sub_abc123",
    "status": "CANCELLED"
  }
}
```

### Refund a Payment

```bash
POST /refund/:paymentId
Content-Type: application/json

{
  "reason": "Customer requested refund"
}
```

Refunds a card (fiat) payment. Only payments with status `PAYMENT_SUCCESS` or `CHECKOUT_SUCCESS` and source `FIAT` can be refunded. Crypto payments cannot be refunded.

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_abc123",
    "status": "REFUNDED"
  }
}
```

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

### Get Customer by ID

```bash
GET /customer/:customerId?page=1&limit=25
```

Returns customer details with their payment history on your products.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "clx_abc123",
    "email": "customer@example.com",
    "name": "John Doe",
    "createdAt": "2026-01-15T10:30:00.000Z",
    "updatedAt": "2026-03-01T14:00:00.000Z",
    "payments": [
      {
        "id": "pay_xyz789",
        "status": "TX_SUCCESS",
        "productId": "pro_abc123",
        "method": "WALLET_CONNECT",
        "currency": "USDC",
        "amount": "999000000",
        "decimals": 6,
        "valueUsd": "999",
        "createdAt": "2026-03-01T14:00:00.000Z",
        "updatedAt": "2026-03-01T14:05:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 25,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

### Find Customer by Email

```bash
GET /customer/search?email=customer@example.com&page=1&limit=25
```

Same response format as Get Customer by ID. Finds the customer by email address.

**Notes:**
- Only customers who have payments on your products are returned
- Payment history only includes payments made on your products (not other merchants)
- Payments are sorted by date (most recent first)

---

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

### Creating a One-Time Payment

```bash
curl -X POST http://localhost:3000/payment/create \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "pro_456def",
    "customerEmail": "test@example.com",
    "externalRef": "order_123",
    "metadata": {
      "userId": "user_456"
    },
    "successUrl": "https://your-app.com/success",
    "cancelUrl": "https://your-app.com/cancel"
  }'
```

### Creating a Subscription Payment

```bash
curl -X POST http://localhost:3000/subscription/create \
  -H "Content-Type: application/json" \
  -d '{
    "productId": "pro_sub789",
    "customerEmail": "test@example.com",
    "externalRef": "sub_001"
  }'
```

### Simulating a Webhook (for testing)

```bash
# Generate signature with complete payload including customer fields
TIMESTAMP=$(date +%s)
BODY='{"id":"evt_test123","type":"PAYMENT_SUCCESS","createdAt":"2026-02-05T10:30:00.000Z","data":{"payment":{"id":"pay_abc123xyz","status":"PAYMENT_SUCCESS","subscriptionId":"sub_xyz789","productId":"product_456def","valueUsd":"999","priceCents":"999","currency":"USD","vatAmountCents":null,"totalAmountCents":null,"txHash":null,"source":"FIAT","customerEmail":"customer@example.com","customerDiscordId":null,"customerTelegramId":null,"customerDiscordUsername":null,"customerTelegramUsername":null},"context":{"externalRef":"order_789xyz","metadata":{"orderId":"12345","source":"mobile_app"},"successUrl":"https://your-app.com/success","cancelUrl":"https://your-app.com/cancel"}}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "your_webhook_secret_here" | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: PAYMENT_SUCCESS" \
  -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
  -H "X-Webhook-Signature: v1=${SIGNATURE}" \
  -d "${BODY}"
```

**Payment Webhook Payload:**

```typescript
interface PaymentWebhookEvent {
  id: string;                    // Unique event ID (evt_xxx format)
  type: "CHECKOUT_INITIATED" | "CHECKOUT_SUCCESS" | "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "PAYMENT_REFUNDED";
  createdAt: string;             // ISO 8601 timestamp
  data: {
    payment: {
      id: string;                // Payment ID
      status: string;            // Payment status
      subscriptionId: string | null;
      productId: string | null;
      valueUsd: string | null;   // Amount in cents
      priceCents: string | null; // Price in cents (custom price products)
      currency: string | null;   // Price currency: "USD" or "EUR"
      vatAmountCents: number | null;    // VAT amount in cents (card only)
      totalAmountCents: number | null;  // Total amount including VAT (card only)
      txHash: string | null;     // Blockchain transaction hash (crypto only)
      source: string | null;     // "CRYPTO" or "FIAT"
      customerEmail: string | null;
      customerDiscordId: string | null;
      customerTelegramId: string | null;
      customerDiscordUsername: string | null;
      customerTelegramUsername: string | null;
    };
    context: {
      externalRef: string | null;
      metadata: Record<string, any> | null;
      successUrl: string | null;
      cancelUrl: string | null;
    };
  };
}
```

**Subscription Webhook Payload:**

```typescript
interface SubscriptionWebhookEvent {
  id: string;                    // Unique event ID (evt_xxx format)
  type: "SUBSCRIPTION_PAST_DUE" | "SUBSCRIPTION_EXPIRED";
  createdAt: string;             // ISO 8601 timestamp
  data: {
    subscription: {
      id: string;
      status: string;
      productId: string;
      expiresAt: string | null;  // ISO 8601 timestamp
    };
    lastPayment: {               // Most recent payment on this subscription
      id: string;
      status: string;
      priceCents: string | null;
      currency: string | null;
      createdAt: string;
    } | null;
    customer: {
      email: string | null;
      discordId: string | null;
      telegramId: string | null;
      discordUsername: string | null;
      telegramUsername: string | null;
    };
    context: {
      externalRef: string | null;
      metadata: Record<string, any> | null;
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
| `SUBY_API_URL` | No | Suby.fi API base URL (default: https://api.suby.fi) |

## Available Suby API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/product/create` | Create a product |
| `PATCH` | `/api/product/:productId` | Update a product |
| `GET` | `/api/product/all` | List all products |
| `GET` | `/api/product/:productId` | Get product by ID |
| `POST` | `/api/payment/create` | Create a one-time payment |
| `GET` | `/api/payment/` | List one-time payments |
| `GET` | `/api/payment/:paymentId` | Get payment by ID |
| `POST` | `/api/subscription/create` | Create a subscription payment |
| `GET` | `/api/subscription/` | List subscriptions |
| `GET` | `/api/subscription/:subscriptionId` | Get subscription by ID |
| `DELETE` | `/api/subscription/:subscriptionId` | Cancel a subscription |
| `POST` | `/api/refund/:paymentId` | Refund a card payment |
| `GET` | `/api/customer` | List customers |
| `GET` | `/api/customer/search?email=` | Find customer by email |
| `GET` | `/api/customer/:customerId` | Get customer by ID |

All endpoints require the `X-Suby-Api-Key` header.
