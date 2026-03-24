const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

function initStripe() {
  return stripe;
}

module.exports = { stripe, initStripe };