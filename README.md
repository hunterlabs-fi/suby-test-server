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

Example webhook events:
- `CHECKOUT_INITIATED` - Payment checkout initiated
- `CHECKOUT_SUCCESS` - Checkout completed
- `PAYMENT_SUCCESS` - Payment successful
- `PAYMENT_FAILED` - Payment failed

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

### Simulating a Webhook (for testing)

```bash
# Generate signature
TIMESTAMP=$(date +%s)
BODY='{"id":"evt_test","type":"PAYMENT_SUCCESS","createdAt":"2026-01-22T10:30:00.000Z","data":{"payment":{"id":"pay_123","status":"PAYMENT_SUCCESS","subscriptionId":null,"planId":"plan_456"},"context":{}}}'
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "your_webhook_secret_here" | cut -d' ' -f2)

# Send webhook
curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Event: PAYMENT_SUCCESS" \
  -H "X-Webhook-Timestamp: ${TIMESTAMP}" \
  -H "X-Webhook-Signature: v1=${SIGNATURE}" \
  -d "${BODY}"
```

## Security Features

- HMAC-SHA256 signature verification for webhooks
- Timestamp validation (rejects webhooks > 5 minutes old)
- Raw body preservation for signature verification
- Bearer token authentication for API calls

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
