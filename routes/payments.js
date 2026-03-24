const express = require('express');
const router = express.Router();
const { stripe } = require('../services/stripe');
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const auth = require('../middleware/auth');

// Создать сессию оформления подписки
router.post('/create-checkout-session', auth, async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: 'price_premium', quantity: 1 }],
    mode: 'subscription',
    success_url: `${process.env.CLIENT_URL}/success`,
    cancel_url: `${process.env.CLIENT_URL}/cancel`,
    client_reference_id: req.userId,
  });
  res.json({ id: session.id });
});

// Webhook для Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const subscription = new Subscription({
      user: userId,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      plan: 'premium',
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });
    await subscription.save();
  }
  res.json({ received: true });
});

// Проверить статус подписки
router.get('/status', auth, async (req, res) => {
  const sub = await Subscription.findOne({ user: req.userId, status: 'active' });
  res.json({ premium: !!sub });
});

module.exports = router;