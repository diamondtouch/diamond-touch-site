// Diamond Touch Detailing — process-payment edge function
// Handles Square charge + Supabase booking insert server-side

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ??
  "EAAAl0s0I_kqtyH9ilnPy83_wv7c_ITJ_tWsFRI9_Htn9zeNdRO7kCTswXETh4I2";
const SQUARE_API_URL = "https://connect.squareup.com/v2/payments";
const SQUARE_VERSION = "2024-06-04";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";

const RESEND_API_KEY = "re_jUFg2vy6_2572fxadFZLiMVk9dYvBon9E";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { sourceId, amount, currency, locationId, note, buyerEmail, bookingData, userToken, couponId } = body;

    if (!sourceId || !amount || !locationId || !bookingData) {
      return new Response(JSON.stringify({ success: false, error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Charge via Square
    const idempotencyKey = `dtd-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const squareRes = await fetch(SQUARE_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        source_id: sourceId,
        amount_money: { amount, currency: currency ?? "USD" },
        location_id: locationId,
        note: note ?? "Diamond Touch Detailing deposit",
        buyer_email_address: buyerEmail,
      }),
    });

    const squareData = await squareRes.json();

    if (!squareRes.ok || squareData.errors) {
      const errMsg = squareData.errors?.[0]?.detail ?? "Payment declined. Please try again.";
      return new Response(JSON.stringify({ success: false, error: errMsg }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentId = squareData.payment?.id;

    // 2. Get user_id from session token if provided
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let userId: string | null = null;

    if (userToken) {
      try {
        const { data: { user } } = await supabase.auth.getUser(userToken);
        userId = user?.id ?? null;
      } catch (_) { /* guest checkout — no user_id */ }
    }

    // 3. Insert booking
    const { data: booking, error: dbError } = await supabase
      .from("bookings")
      .insert({
        user_id: userId,
        service_name: bookingData.service,
        vehicle_type: bookingData.vehicle_type,
        preferred_date: bookingData.preferred_date ?? null,
        preferred_time: bookingData.preferred_time ?? null,
        notes: [
          bookingData.notes,
          `Customer: ${bookingData.name}`,
          `Email: ${bookingData.email}`,
          `Phone: ${bookingData.phone}`,
        ].filter(Boolean).join(" | "),
        deposit_paid: true,
        deposit_amount: 5000,
        total_amount: bookingData.total_amount ?? null,
        square_payment_id: paymentId,
        status: "confirmed",
      })
      .select("id")
      .single();

    if (dbError) {
      console.error("DB insert error:", dbError.message);
      // Payment captured — return success with warning
      return new Response(
        JSON.stringify({ success: true, paymentId, bookingId: null, warning: "Booking saved but may be delayed." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Increment coupon usage if applied
    if (couponId) {
      try {
        await supabase.rpc('increment_coupon_uses', { coupon_id: couponId });
      } catch (_) {}
      // Fallback: direct update
      try {
        await supabase.from('coupons').update({ uses_count: supabase.rpc('uses_count + 1') }).eq('id', couponId);
      } catch (_) {}
    }

    // 5. Auto-save phone + vehicle to user profile/garage if logged in
    if (userId) {
      try {
        // Save phone to profile if missing
        if (bookingData.phone) {
          const { data: prof } = await supabase.from('profiles').select('phone').eq('id', userId).single();
          if (prof && !prof.phone) {
            await supabase.from('profiles').update({ phone: bookingData.phone }).eq('id', userId);
          }
        }

        // Auto-save vehicle if user filled in vehicle details
        const vYear  = bookingData.vehicle_year  || null;
        const vMake  = bookingData.vehicle_make  || null;
        const vModel = bookingData.vehicle_model || null;
        const vColor = bookingData.vehicle_color || null;
        const vType  = bookingData.vehicle_type  || null;

        if (vMake || vType) {
          // Check for existing identical vehicle
          let query = supabase.from('vehicles').select('id').eq('user_id', userId).eq('type', vType || 'sedan');
          if (vMake)  query = query.eq('make', vMake);
          if (vModel) query = query.eq('model', vModel);
          const { data: existing } = await query.limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('vehicles').insert({
              user_id: userId,
              year:  vYear,
              make:  vMake,
              model: vModel,
              color: vColor,
              type:  vType || 'sedan',
            });
          }
        }
      } catch (_) { /* don't fail booking */ }
    }

    // 5. Send confirmation email + SMS
    const dateDisplay = bookingData.preferred_date
      ? new Date(bookingData.preferred_date + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
      : 'To be confirmed';
    const timeDisplay = bookingData.preferred_time
      ? (() => { const [h,m] = bookingData.preferred_time.split(':'); const hr=parseInt(h); return `${hr>12?hr-12:hr||12}:${m} ${hr>=12?'PM':'AM'}`; })()
      : 'To be confirmed';
    const depositDisplay = bookingData.deposit_amount ? `$${(bookingData.deposit_amount/100).toFixed(0)}` : '$50';
    const totalDisplay = bookingData.total_amount ? `$${(bookingData.total_amount/100).toFixed(0)}` : 'TBD';

    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>",
          to: [bookingData.email],
          subject: `Booking Confirmed — ${bookingData.service} on ${dateDisplay}`,
          html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#111;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid #1a1a1a">
    <div style="font-size:28px;letter-spacing:.15em;color:#e91e8c;font-weight:700">◆ DIAMOND TOUCH</div>
    <div style="font-size:11px;letter-spacing:.3em;color:#666;text-transform:uppercase;margin-top:4px">DETAILING</div>
  </td></tr>

  <!-- Hero -->
  <tr><td style="background:#111;padding:40px 40px 32px;text-align:center">
    <div style="width:56px;height:56px;background:#e91e8c1a;border-radius:50%;margin:0 auto 20px;display:flex;align-items:center;justify-content:center;font-size:24px;line-height:56px">✓</div>
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#f5f5f5">You're Booked!</h1>
    <p style="margin:0;font-size:15px;color:#888">Your appointment is confirmed and your deposit is secured.</p>
  </td></tr>

  <!-- Booking details -->
  <tr><td style="background:#111;padding:0 40px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:10px;overflow:hidden">
      <tr style="border-bottom:1px solid #1a1a1a">
        <td style="padding:16px 20px;font-size:13px;color:#666;width:40%">Service</td>
        <td style="padding:16px 20px;font-size:15px;color:#f5f5f5;font-weight:600">${bookingData.service}</td>
      </tr>
      <tr style="border-bottom:1px solid #1a1a1a">
        <td style="padding:16px 20px;font-size:13px;color:#666">Vehicle</td>
        <td style="padding:16px 20px;font-size:15px;color:#f5f5f5;text-transform:capitalize">${bookingData.vehicle_type}</td>
      </tr>
      <tr style="border-bottom:1px solid #1a1a1a">
        <td style="padding:16px 20px;font-size:13px;color:#666">Date</td>
        <td style="padding:16px 20px;font-size:15px;color:#f5f5f5">${dateDisplay}</td>
      </tr>
      <tr style="border-bottom:1px solid #1a1a1a">
        <td style="padding:16px 20px;font-size:13px;color:#666">Time</td>
        <td style="padding:16px 20px;font-size:15px;color:#f5f5f5">${timeDisplay}</td>
      </tr>
      ${bookingData.notes ? `<tr style="border-bottom:1px solid #1a1a1a"><td style="padding:16px 20px;font-size:13px;color:#666">Details</td><td style="padding:16px 20px;font-size:13px;color:#aaa">${bookingData.notes}</td></tr>` : ''}
      <tr style="border-bottom:1px solid #1a1a1a">
        <td style="padding:16px 20px;font-size:13px;color:#666">Deposit Paid</td>
        <td style="padding:16px 20px;font-size:15px;color:#4ade80;font-weight:700">${depositDisplay} ✓</td>
      </tr>
      <tr>
        <td style="padding:16px 20px;font-size:13px;color:#666">Balance at Service</td>
        <td style="padding:16px 20px;font-size:15px;color:#f5f5f5">${totalDisplay !== 'TBD' ? '$' + (Math.max(0, bookingData.total_amount - (bookingData.deposit_amount || 5000)) / 100).toFixed(0) : 'TBD'}</td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="background:#111;padding:0 40px 32px;text-align:center">
    <p style="font-size:14px;color:#666;margin:0 0 20px">Need to make changes? Log in to your account to manage your booking.</p>
    <a href="https://diamondtouchdetails.com/portal/bookings.html" style="display:inline-block;background:#e91e8c;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:14px;font-weight:600;letter-spacing:.03em">View My Bookings</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0d0d0d;border-radius:0 0 12px 12px;padding:24px 40px;text-align:center;border-top:1px solid #1a1a1a">
    <p style="margin:0 0 4px;font-size:12px;color:#444">◆ Diamond Touch Detailing — Your Vehicle. Perfected.</p>
    <p style="margin:0;font-size:12px;color:#333">Murrieta, CA &nbsp;·&nbsp; <a href="mailto:sales@diamondtouchdetails.com" style="color:#333">sales@diamondtouchdetails.com</a></p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`,
        }),
      });
    } catch (emailErr) {
      console.error("Email send error:", emailErr);
    }

    // SMS notification via Twilio (configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)
    const TWILIO_SID   = Deno.env.get("TWILIO_ACCOUNT_SID");
    const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
    const TWILIO_FROM  = Deno.env.get("TWILIO_FROM_NUMBER");
    if (TWILIO_SID && TWILIO_TOKEN && TWILIO_FROM && bookingData.phone) {
      try {
        const smsBody = `\u2666 Diamond Touch Detailing\nBooking confirmed!\n\nService: ${bookingData.service}\nDate: ${dateDisplay}\nTime: ${timeDisplay}\nDeposit: ${depositDisplay} paid\n\nQuestions? Reply to this text or visit diamondtouchdetails.com`;
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: TWILIO_FROM,
            To: bookingData.phone.replace(/[^+\d]/g, '').replace(/^(\d{10})$/, '+1$1'),
            Body: smsBody,
          }).toString(),
        });
      } catch (smsErr) {
        console.error("SMS send error:", smsErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, paymentId, bookingId: booking.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
