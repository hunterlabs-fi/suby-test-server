import express, { Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const SUBY_API_KEY = process.env.SUBY_API_KEY;
const SUBY_API_URL = process.env.SUBY_API_URL || 'https://api.suby.fi';

// ── Type definitions ────────────────────────────────────────────────

interface PaymentWebhookPayload {
  id: string;
  type: 'CHECKOUT_INITIATED' | 'CHECKOUT_SUCCESS' | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'PAYMENT_REFUNDED';
  createdAt: string;
  data: {
    payment: {
      id: string;
      status: string;
      subscriptionId: string | null;
      productId: string | null;
      valueUsd: string | null;
      priceCents: string | null;
      currency: string | null;
      vatAmountCents: number | null;
      totalAmountCents: number | null;
      txHash: string | null;
      source: string | null;
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

interface SubscriptionWebhookPayload {
  id: string;
  type: 'SUBSCRIPTION_PAST_DUE' | 'SUBSCRIPTION_EXPIRED';
  createdAt: string;
  data: {
    subscription: {
      id: string;
      status: string;
      productId: string;
      expiresAt: string | null;
    };
    lastPayment: {
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

type WebhookPayload = PaymentWebhookPayload | SubscriptionWebhookPayload;

interface PaymentCreateRequest {
  productId: string;
  customerEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  externalRef?: string;
  metadata?: Record<string, any>;
  priceCents?: string;
  currency?: string;
  successUrl?: string;
  cancelUrl?: string;
}

interface SubscriptionCreateRequest {
  productId: string;
  customerEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  externalRef?: string;
  metadata?: Record<string, any>;
  successUrl?: string;
  cancelUrl?: string;
}

interface ProductCreateRequest {
  name: string;
  description?: string;
  frequencyInDays?: number | null;
  isSandbox?: boolean;
  isCustomPrice?: boolean;
  priceCents?: string;
  currency?: 'USD' | 'EUR';
  platform?: 'WEB' | 'INVOICE';
  paymentMethods: ('CRYPTO' | 'CARD')[];
  acceptedAssets?: string[];
  acceptedChains?: number[];
  supply?: number | null;
  imageUrl?: string;
}

interface ProductUpdateRequest {
  status?: 'ACTIVE' | 'CANCELLED';
  priceCents?: string;
  frequencyInDays?: number | null;
  supply?: number;
}

// ── Middleware ───────────────────────────────────────────────────────

// Raw body parser for webhook endpoint (needed for signature verification)
app.use('/webhooks', express.raw({ type: 'application/json' }));

// JSON parser for all other routes
app.use(express.json());

// ── Helper: forward request to Suby API ─────────────────────────────

const subyHeaders = () => ({
  'X-Suby-Api-Key': `${SUBY_API_KEY}`,
  'Content-Type': 'application/json',
});

// ── Health check ────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// ── Webhook endpoint ────────────────────────────────────────────────

app.post('/webhooks', (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const timestamp = req.headers['x-webhook-timestamp'] as string;
    const eventType = req.headers['x-webhook-event'] as string;

    if (!signature || !timestamp) {
      console.error('[Webhook] Missing required headers');
      return res.status(400).json({ error: 'Missing required headers' });
    }

    if (!WEBHOOK_SECRET) {
      console.error('[Webhook] WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const rawBody = req.body.toString('utf8');

    // Verify timestamp (must be within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTimestamp = parseInt(timestamp);
    const webhookAge = currentTime - webhookTimestamp;

    if (webhookAge > 300) {
      console.error(`[Webhook] Timestamp too old: ${webhookAge} seconds`);
      return res.status(400).json({ error: 'Webhook timestamp too old' });
    }

    // Verify HMAC-SHA256 signature
    const signedPayload = `${timestamp}.${rawBody}`;
    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    const receivedSignature = signature.replace('v1=', '');

    if (receivedSignature !== expectedSignature) {
      console.error('[Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse webhook
    const webhook: WebhookPayload = JSON.parse(rawBody);

    console.log('\n=== Webhook Received ===');
    console.log('Event ID:', webhook.id);
    console.log('Event Type:', webhook.type);
    if (eventType) console.log('Event Header:', eventType);

    // Handle payment events
    if ('payment' in webhook.data) {
      const { payment, context } = (webhook as PaymentWebhookPayload).data;

      console.log('Payment ID:', payment.id);
      console.log('Payment Status:', payment.status);
      if (payment.productId) console.log('Product ID:', payment.productId);
      if (payment.valueUsd) console.log('Amount (USD):', payment.valueUsd);
      if (payment.priceCents) console.log('Price:', payment.priceCents, payment.currency);
      if (payment.vatAmountCents) console.log('VAT (cents):', payment.vatAmountCents);
      if (payment.totalAmountCents) console.log('Total (cents):', payment.totalAmountCents);
      if (payment.source) console.log('Source:', payment.source);
      if (payment.txHash) console.log('Tx Hash:', payment.txHash);

      if (payment.customerEmail) console.log('Customer Email:', payment.customerEmail);
      if (payment.customerDiscordId) {
        console.log('Discord ID:', payment.customerDiscordId);
        if (payment.customerDiscordUsername) console.log('Discord Username:', payment.customerDiscordUsername);
      }
      if (payment.customerTelegramId) {
        console.log('Telegram ID:', payment.customerTelegramId);
        if (payment.customerTelegramUsername) console.log('Telegram Username:', payment.customerTelegramUsername);
      }

      if (context.externalRef) console.log('External Ref:', context.externalRef);
      if (context.metadata) console.log('Metadata:', JSON.stringify(context.metadata, null, 2));

      switch (webhook.type) {
        case 'CHECKOUT_INITIATED':
          console.log('[Webhook] Checkout initiated');
          break;
        case 'CHECKOUT_SUCCESS':
          console.log('[Webhook] Checkout completed successfully');
          break;
        case 'PAYMENT_SUCCESS':
          console.log('[Webhook] Payment successful');
          break;
        case 'PAYMENT_FAILED':
          console.log('[Webhook] Payment failed');
          break;
        case 'PAYMENT_REFUNDED':
          console.log('[Webhook] Payment refunded');
          break;
      }
    }

    // Handle subscription events
    if ('subscription' in webhook.data) {
      const { subscription, lastPayment, customer, context } = (webhook as SubscriptionWebhookPayload).data;

      console.log('Subscription ID:', subscription.id);
      console.log('Subscription Status:', subscription.status);
      console.log('Product ID:', subscription.productId);
      if (subscription.expiresAt) console.log('Expires At:', subscription.expiresAt);

      if (lastPayment) {
        console.log('Last Payment ID:', lastPayment.id);
        console.log('Last Payment Status:', lastPayment.status);
        if (lastPayment.priceCents) console.log('Last Payment Price:', lastPayment.priceCents, lastPayment.currency);
      }

      if (customer.email) console.log('Customer Email:', customer.email);
      if (customer.discordId) console.log('Discord ID:', customer.discordId);
      if (customer.telegramId) console.log('Telegram ID:', customer.telegramId);
      if (context.externalRef) console.log('External Ref:', context.externalRef);
      if (context.metadata) console.log('Metadata:', JSON.stringify(context.metadata, null, 2));

      switch (webhook.type) {
        case 'SUBSCRIPTION_PAST_DUE':
          console.log('[Webhook] Subscription payment is overdue');
          break;
        case 'SUBSCRIPTION_EXPIRED':
          console.log('[Webhook] Subscription has expired');
          break;
      }
    }

    console.log('========================\n');

    res.status(200).json({ received: true, eventId: webhook.id });

  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create one-time payment ─────────────────────────────────────────

app.post('/payment/create', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Payment] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const body: PaymentCreateRequest = req.body;

    if (!body.productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    console.log('\n=== Creating Payment ===');
    console.log('Product ID:', body.productId);
    if (body.customerEmail) console.log('Customer Email:', body.customerEmail);
    if (body.externalRef) console.log('External Ref:', body.externalRef);
    if (body.priceCents) console.log('Custom Price:', body.priceCents, body.currency);
    if (body.metadata) console.log('Metadata:', JSON.stringify(body.metadata, null, 2));

    const response = await axios.post(
      `${SUBY_API_URL}/api/payment/create`,
      body,
      { headers: subyHeaders() }
    );

    if (response.data.success && response.data.data) {
      console.log('Payment created successfully!');
      console.log('Payment ID:', response.data.data.paymentId);
      console.log('Payment URL:', response.data.data.paymentUrl);
      console.log('========================\n');
      return res.status(200).json(response.data);
    } else {
      console.error('[Payment] Unexpected response format');
      return res.status(500).json({ error: 'Unexpected response from payment API' });
    }

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Payment] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Payment] Error creating payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create subscription payment ─────────────────────────────────────

app.post('/subscription/create', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Subscription] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const body: SubscriptionCreateRequest = req.body;

    if (!body.productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    console.log('\n=== Creating Subscription ===');
    console.log('Product ID:', body.productId);
    if (body.customerEmail) console.log('Customer Email:', body.customerEmail);
    if (body.externalRef) console.log('External Ref:', body.externalRef);

    const response = await axios.post(
      `${SUBY_API_URL}/api/subscription/create`,
      body,
      { headers: subyHeaders() }
    );

    if (response.data.success && response.data.data) {
      console.log('Subscription created successfully!');
      console.log('Payment ID:', response.data.data.paymentId);
      console.log('Payment URL:', response.data.data.paymentUrl);
      console.log('========================\n');
      return res.status(200).json(response.data);
    } else {
      console.error('[Subscription] Unexpected response format');
      return res.status(500).json({ error: 'Unexpected response from subscription API' });
    }

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Subscription] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Subscription] Error creating subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Cancel subscription ─────────────────────────────────────────────

app.delete('/subscription/:subscriptionId', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Subscription] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { subscriptionId } = req.params;

    console.log('\n=== Cancelling Subscription ===');
    console.log('Subscription ID:', subscriptionId);

    const response = await axios.delete(
      `${SUBY_API_URL}/api/subscription/${subscriptionId}`,
      { headers: subyHeaders() }
    );

    console.log('Subscription cancelled successfully!');
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Subscription] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Subscription] Error cancelling subscription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Create product ──────────────────────────────────────────────────

app.post('/product/create', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Product] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const body: ProductCreateRequest = req.body;

    if (!body.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!body.paymentMethods || body.paymentMethods.length === 0) {
      return res.status(400).json({ error: 'paymentMethods is required' });
    }
    if (!body.isCustomPrice && !body.priceCents) {
      return res.status(400).json({ error: 'priceCents is required when isCustomPrice is not true' });
    }
    if (!body.isCustomPrice && !body.currency) {
      return res.status(400).json({ error: 'currency is required when isCustomPrice is not true' });
    }

    console.log('\n=== Creating Product ===');
    console.log('Name:', body.name);
    if (body.isCustomPrice) {
      console.log('Custom Price: enabled');
    } else {
      console.log('Price:', body.priceCents, body.currency);
    }
    console.log('Platform:', body.platform || 'WEB (default)');
    console.log('Payment Methods:', body.paymentMethods.join(', '));
    if (body.frequencyInDays) console.log('Frequency:', body.frequencyInDays, 'days');
    if (body.acceptedAssets) console.log('Assets:', body.acceptedAssets.join(', '));
    if (body.acceptedChains) console.log('Chains:', body.acceptedChains.join(', '));
    if (body.supply) console.log('Supply:', body.supply);

    const response = await axios.post(
      `${SUBY_API_URL}/api/product/create`,
      body,
      { headers: subyHeaders() }
    );

    console.log('Product created successfully!');
    console.log('Product ID:', response.data.data?.id);
    console.log('Status:', response.data.data?.status);
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Product] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Product] Error creating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Update product ──────────────────────────────────────────────────

app.patch('/product/:productId', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Product] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { productId } = req.params;
    const body: ProductUpdateRequest = req.body;

    console.log('\n=== Updating Product ===');
    console.log('Product ID:', productId);
    if (body.status) console.log('Status:', body.status);
    if (body.priceCents) console.log('Price:', body.priceCents);
    if (body.frequencyInDays !== undefined) console.log('Frequency:', body.frequencyInDays, 'days');
    if (body.supply) console.log('Supply:', body.supply);

    const response = await axios.patch(
      `${SUBY_API_URL}/api/product/${productId}`,
      body,
      { headers: subyHeaders() }
    );

    console.log('Product updated successfully!');
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Product] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Product] Error updating product:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Refund a payment ────────────────────────────────────────────────

app.post('/refund/:paymentId', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Refund] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { paymentId } = req.params;
    const { reason } = req.body;

    console.log('\n=== Refunding Payment ===');
    console.log('Payment ID:', paymentId);
    if (reason) console.log('Reason:', reason);

    const response = await axios.post(
      `${SUBY_API_URL}/api/refund/${paymentId}`,
      { reason },
      { headers: subyHeaders() }
    );

    console.log('Payment refunded successfully!');
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Refund] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Refund] Error refunding payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List customers ──────────────────────────────────────────────────

app.get('/customer', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Customer] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const page = req.query.page || 1;
    const limit = req.query.limit || 25;

    console.log('\n=== Listing Customers ===');
    console.log('Page:', page, '| Limit:', limit);

    const response = await axios.get(
      `${SUBY_API_URL}/api/customer`,
      {
        params: { page, limit },
        headers: { 'X-Suby-Api-Key': `${SUBY_API_KEY}` },
      }
    );

    console.log('Total customers:', response.data.data?.pagination?.total || 0);
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Customer] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Customer] Error listing customers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Find customer by email ──────────────────────────────────────────

app.get('/customer/search', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Customer] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { email, page, limit } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    console.log('\n=== Searching Customer ===');
    console.log('Email:', email);

    const response = await axios.get(
      `${SUBY_API_URL}/api/customer/search`,
      {
        params: { email, page: page || 1, limit: limit || 25 },
        headers: { 'X-Suby-Api-Key': `${SUBY_API_KEY}` },
      }
    );

    console.log('Customer found!');
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Customer] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Customer] Error searching customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Get customer by ID ──────────────────────────────────────────────

app.get('/customer/:customerId', async (req: Request, res: Response) => {
  try {
    if (!SUBY_API_KEY) {
      console.error('[Customer] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const { customerId } = req.params;
    const { page, limit } = req.query;

    console.log('\n=== Getting Customer ===');
    console.log('Customer ID:', customerId);

    const response = await axios.get(
      `${SUBY_API_URL}/api/customer/${customerId}`,
      {
        params: { page: page || 1, limit: limit || 25 },
        headers: { 'X-Suby-Api-Key': `${SUBY_API_KEY}` },
      }
    );

    console.log('Customer retrieved!');
    console.log('========================\n');

    return res.status(200).json(response.data);

  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      console.error('[Customer] API Error:', error.response.data);
      return res.status(error.response.status).json(error.response.data);
    }
    console.error('[Customer] Error getting customer:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Start server ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nServer running on ${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`   GET    /health                        - Health check`);
  console.log(`   POST   /webhooks                      - Webhook receiver (signed)`);
  console.log(`   POST   /payment/create                - Create one-time payment`);
  console.log(`   POST   /subscription/create           - Create subscription payment`);
  console.log(`   DELETE /subscription/:subscriptionId   - Cancel subscription`);
  console.log(`   POST   /product/create                - Create product`);
  console.log(`   PATCH  /product/:productId            - Update product`);
  console.log(`   POST   /refund/:paymentId             - Refund a card payment`);
  console.log(`   GET    /customer                      - List customers`);
  console.log(`   GET    /customer/search?email=        - Find customer by email`);
  console.log(`   GET    /customer/:customerId          - Get customer by ID\n`);

  if (!WEBHOOK_SECRET) {
    console.warn('WARNING: WEBHOOK_SECRET not set in .env file');
  }
  if (!SUBY_API_KEY) {
    console.warn('WARNING: SUBY_API_KEY not set in .env file');
  }

  console.log('');
});
