/* ============================================================
   DIAMOND TOUCH DETAILING — booking.js
   Square Payments + Supabase Booking Handler
   ============================================================ */

'use strict';

// ─── Config ──────────────────────────────────────────────
const SUPABASE_URL      = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1MzI2NDUsImV4cCI6MjA5MTEwODY0NX0.XT_T3h9wsoPJqMTeBV0ohoCbAiDc8oFdZg7LHxoAeAM";
const APP_ID            = "sandbox-sq0idb-e4hfCqcraP5ssqJLEEJcoA";
const LOCATION_ID       = "YOUR_LOCATION_ID"; // replace before going live
const DEPOSIT_AMOUNT    = 5000; // $50.00 in cents

/* ─── Supabase bookings table (run once to create):
CREATE TABLE bookings (
  id                uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        timestamptz   DEFAULT now(),
  name              text          NOT NULL,
  email             text          NOT NULL,
  phone             text          NOT NULL,
  service           text          NOT NULL,
  vehicle_type      text          NOT NULL,
  preferred_date    date,
  notes             text,
  deposit_paid      boolean       DEFAULT false,
  square_payment_id text,
  status            text          DEFAULT 'pending'
);
──────────────────────────────────────────────────────────── */

// ─── DOM References ───────────────────────────────────────
const form          = document.getElementById('bookingForm');
const submitBtn     = document.getElementById('submitBtn');
const statusEl      = document.getElementById('payment-status');
const cardContainer = document.getElementById('card-container');

if (!form || !cardContainer) {
  // Booking section not present on this page — exit silently
  throw new Error('Booking form not found — skipping booking.js init');
}

// ─── Supabase insert helper ───────────────────────────────
async function insertBooking(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Database error' }));
    throw new Error(err.message || 'Failed to save booking');
  }

  return res.json();
}

// ─── UI Helpers ───────────────────────────────────────────
function setStatus(message, type = '') {
  statusEl.textContent = message;
  statusEl.className   = 'payment-status';
  if (type) statusEl.classList.add(type);
  if (message) statusEl.style.display = 'block';
  else         statusEl.style.display = 'none';
}

function setLoading(loading) {
  submitBtn.classList.toggle('loading', loading);
  submitBtn.disabled = loading;
}

function getFormData() {
  return {
    name:           form.elements.name.value.trim(),
    email:          form.elements.email.value.trim(),
    phone:          form.elements.phone.value.trim(),
    service:        form.elements.service.value,
    vehicle_type:   form.elements.vehicle_type.value,
    preferred_date: form.elements.preferred_date.value || null,
    notes:          form.elements.notes.value.trim() || null,
  };
}

function validateForm(data) {
  const errors = [];
  if (!data.name)         errors.push('Full name is required.');
  if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))
                          errors.push('A valid email address is required.');
  if (!data.phone)        errors.push('Phone number is required.');
  if (!data.service)      errors.push('Please select a service.');
  if (!data.vehicle_type) errors.push('Please select a vehicle type.');
  return errors;
}

// ─── Square Payments Init ─────────────────────────────────
let squareCard = null;

async function initSquare() {
  if (typeof Square === 'undefined') {
    console.warn('Square SDK not loaded — payment form disabled.');
    cardContainer.innerHTML = '<p style="color: var(--clr-muted); font-size: 0.875rem; padding: 0.5rem 0;">Payment processing unavailable. Please contact us directly to book.</p>';
    return;
  }

  try {
    const payments = Square.payments(APP_ID, LOCATION_ID);

    squareCard = await payments.card({
      style: {
        '.input-container': {
          borderColor: 'transparent',
          borderRadius: '0',
        },
        '.input-container.is-focus': {
          borderColor: 'transparent',
        },
        '.input-container.is-error': {
          borderColor: 'transparent',
        },
        input: {
          color:            '#f5f5f5',
          fontFamily:       "'DM Sans', system-ui, sans-serif",
          fontSize:         '15px',
          fontWeight:       '400',
          backgroundColor:  'transparent',
        },
        'input::placeholder': {
          color: '#555555',
        },
        '.message-text': {
          color: '#e91e8c',
        },
      },
    });

    await squareCard.attach('#card-container');

    // Apply focus styling to container
    cardContainer.addEventListener('focusin', () => {
      cardContainer.classList.add('sq-focused');
    });
    cardContainer.addEventListener('focusout', () => {
      cardContainer.classList.remove('sq-focused');
    });

  } catch (err) {
    console.error('Square init error:', err);
    setStatus('Payment form could not be loaded. Please try refreshing the page.', 'error');
  }
}

// ─── Form Submit ──────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setStatus('');

  const data   = getFormData();
  const errors = validateForm(data);

  if (errors.length) {
    setStatus(errors[0], 'error');
    // Focus first invalid field
    const fieldMap = {
      'Full name':   'name',
      'valid email': 'email',
      'Phone':       'phone',
      'service':     'service',
      'vehicle':     'vehicle_type',
    };
    for (const [key, id] of Object.entries(fieldMap)) {
      if (errors[0].toLowerCase().includes(key.toLowerCase())) {
        document.getElementById(id)?.focus();
        break;
      }
    }
    return;
  }

  if (!squareCard) {
    setStatus('Payment form is not available. Please contact us to book.', 'error');
    return;
  }

  setLoading(true);

  try {
    // 1. Tokenize the card
    const tokenResult = await squareCard.tokenize();

    if (tokenResult.status !== 'OK') {
      const errMsg = tokenResult.errors
        ? tokenResult.errors.map(e => e.message).join(' ')
        : 'Card verification failed. Please check your details.';
      setStatus(errMsg, 'error');
      setLoading(false);
      return;
    }

    const sourceId = tokenResult.token;

    // 2. Charge the card via Square Payments API
    //    In production this MUST go through your own server to keep API keys secret.
    //    For sandbox demo we call the Square sandbox endpoint directly.
    const paymentRes = await fetch('https://connect.squareupsandbox.com/v2/payments', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-06-04',
        'Content-Type':   'application/json',
        // WARNING: Never expose your Square access token client-side in production.
        // Move this to a server-side function (Netlify Function, Supabase Edge Function, etc.)
        'Authorization':  'Bearer YOUR_SANDBOX_ACCESS_TOKEN',
      },
      body: JSON.stringify({
        idempotency_key: `dtd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        source_id:       sourceId,
        amount_money: {
          amount:   DEPOSIT_AMOUNT,
          currency: 'USD',
        },
        location_id: LOCATION_ID,
        note:        `Diamond Touch Detailing deposit — ${data.service} for ${data.name}`,
        buyer_email_address: data.email,
      }),
    });

    const paymentData = await paymentRes.json();

    if (!paymentRes.ok || paymentData.errors) {
      const errMsg = paymentData.errors?.[0]?.detail || 'Payment failed. Please try again.';
      setStatus(errMsg, 'error');
      setLoading(false);
      return;
    }

    const paymentId = paymentData.payment?.id;

    // 3. Insert booking into Supabase
    await insertBooking({
      ...data,
      deposit_paid:      true,
      square_payment_id: paymentId,
      status:            'confirmed',
    });

    // 4. Success
    setStatus(
      `✓ Booking confirmed! We'll reach out to ${data.email} with your appointment details. See you soon!`,
      'success'
    );

    form.reset();
    squareCard.destroy();
    squareCard = null;
    cardContainer.innerHTML = '';

    // Scroll to confirmation
    statusEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (err) {
    console.error('Booking error:', err);
    setStatus(
      err.message?.includes('Failed to fetch')
        ? 'Network error. Please check your connection and try again.'
        : `Something went wrong: ${err.message || 'Please try again.'}`,
      'error'
    );
  } finally {
    setLoading(false);
  }
});

// ─── Initialize ───────────────────────────────────────────
initSquare();
