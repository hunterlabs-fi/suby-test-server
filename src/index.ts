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

// Type definitions
interface WebhookPayload {
  id: string;
  type: 'CHECKOUT_INITIATED' | 'CHECKOUT_SUCCESS' | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED';
  createdAt: string;
  data: {
    payment: {
      id: string;
      status: string;
      subscriptionId: string | null;
      productId: string | null;
      valueUsd: string | null;
      txHash: string | null;
      source: string | null;

      // Customer identification fields
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

interface PaymentInitiationRequest {
  planId: string;
  customerEmail?: string;
  discount?: number;
  externalRef?: string;
  metadata?: Record<string, any>;
  successUrl?: string;
  cancelUrl?: string;
}

interface PaymentInitiationResponse {
  success: boolean;
  data?: {
    paymentId: string;
    paymentUrl: string;
    metadata?: Record<string, any>;
  };
  error?: {
    code: string;
    message: string;
  };
}

// Middleware: Use raw body parser for webhook endpoint
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Middleware: Use JSON parser for all other routes
app.use(express.json());

// Webhook endpoint
app.post('/webhooks', (req: Request, res: Response) => {
  try {
    // Extract headers
    const signature = req.headers['x-webhook-signature'] as string;
    const timestamp = req.headers['x-webhook-timestamp'] as string;

    // Validate required headers
    if (!signature || !timestamp) {
      console.error('[Webhook] Missing required headers');
      return res.status(400).json({ error: 'Missing required headers' });
    }

    // Check webhook secret is configured
    if (!WEBHOOK_SECRET) {
      console.error('[Webhook] WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Get raw body as string
    const rawBody = req.body.toString('utf8');

    // Step 1: Verify timestamp (must be within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTimestamp = parseInt(timestamp);
    const webhookAge = currentTime - webhookTimestamp;

    if (webhookAge > 300) {
      console.error(`[Webhook] Timestamp too old: ${webhookAge} seconds`);
      return res.status(400).json({ error: 'Webhook timestamp too old' });
    }

    // Step 2: Verify signature
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

    // Step 3: Parse and process webhook
    const webhook: WebhookPayload = JSON.parse(rawBody);

    console.log('\n=== Webhook Received ===');
    console.log('Event ID:', webhook.id);
    console.log('Event Type:', webhook.type);
    console.log('Payment ID:', webhook.data.payment.id);
    console.log('Payment Status:', webhook.data.payment.status);

    if (webhook.data.payment.productId) {
      console.log('Product ID:', webhook.data.payment.productId);
    }
    if (webhook.data.payment.valueUsd) {
      console.log('Amount (USD):', webhook.data.payment.valueUsd);
    }
    if (webhook.data.payment.source) {
      console.log('Payment Source:', webhook.data.payment.source);
    }
    if (webhook.data.payment.txHash) {
      console.log('Transaction Hash:', webhook.data.payment.txHash);
    }

    // Log customer information
    if (webhook.data.payment.customerEmail) {
      console.log('Customer Email:', webhook.data.payment.customerEmail);
    }
    if (webhook.data.payment.customerDiscordId) {
      console.log('Discord ID:', webhook.data.payment.customerDiscordId);
      if (webhook.data.payment.customerDiscordUsername) {
        console.log('Discord Username:', webhook.data.payment.customerDiscordUsername);
      }
    }
    if (webhook.data.payment.customerTelegramId) {
      console.log('Telegram ID:', webhook.data.payment.customerTelegramId);
      if (webhook.data.payment.customerTelegramUsername) {
        console.log('Telegram Username:', webhook.data.payment.customerTelegramUsername);
      }
    }

    if (webhook.data.context.externalRef) {
      console.log('External Ref:', webhook.data.context.externalRef);
    }

    if (webhook.data.context.metadata) {
      console.log('Metadata:', JSON.stringify(webhook.data.context.metadata, null, 2));
    }

    // Handle different webhook types
    switch (webhook.type) {
      case 'CHECKOUT_INITIATED':
        console.log('[Webhook] Checkout initiated');
        // Add your logic here (e.g., store payment in database)
        break;

      case 'CHECKOUT_SUCCESS':
        console.log('[Webhook] Checkout completed successfully');
        // Add your logic here
        break;

      case 'PAYMENT_SUCCESS':
        console.log('[Webhook] Payment successful!');
        // Add your logic here (e.g., grant access to subscription)
        break;

      case 'PAYMENT_FAILED':
        console.log('[Webhook] Payment failed');
        // Add your logic here (e.g., notify user, retry)
        break;

      default:
        console.log(`[Webhook] Unknown event type: ${webhook.type}`);
    }

    console.log('========================\n');

    // Always respond with 200 to acknowledge receipt
    res.status(200).json({ received: true, eventId: webhook.id });

  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Payment initiation endpoint
app.post('/payment/create', async (req: Request, res: Response) => {
  try {
    // Check API key is configured
    if (!SUBY_API_KEY) {
      console.error('[Payment] SUBY_API_KEY not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const body: PaymentInitiationRequest = req.body;

    // Validate required fields
    if (!body.planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    console.log('\n=== Creating Payment ===');
    console.log('Plan ID:', body.planId);
    if (body.customerEmail) console.log('Customer Email:', body.customerEmail);
    if (body.discount) console.log('Discount:', body.discount, 'basis points');
    if (body.externalRef) console.log('External Ref:', body.externalRef);
    if (body.metadata) console.log('Metadata:', JSON.stringify(body.metadata, null, 2));

    // Call Suby.fi API
    const response = await axios.post<PaymentInitiationResponse>(
      `${SUBY_API_URL}/payment/initiate`,
      body,
      {
        headers: {
          'Authorization': `X-Suby-Api-Key ${SUBY_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
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

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on ${PORT}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /webhooks        - Webhook receiver (signed)`);
  console.log(`   POST /payment/create  - Create payment intent\n`);

  // Warn if environment variables are not set
  if (!WEBHOOK_SECRET) {
    console.warn('⚠️  WARNING: WEBHOOK_SECRET not set in .env file');
  }
  if (!SUBY_API_KEY) {
    console.warn('⚠️  WARNING: SUBY_API_KEY not set in .env file');
  }

  console.log('');
});
