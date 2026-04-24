// Diamond Touch Detailing — process-payment edge function
// Handles Square charge + Supabase booking insert server-side

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ??
  "EAAAl20kKbk-2OoL11fzSd_cMosbjyAmaWnqstux8h8tsxd_7XKpDqkwOt1V62Rb";
const SQUARE_API_URL = "https://connect.squareupsandbox.com/v2/payments";
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
    const { sourceId, amount, currency, locationId, note, buyerEmail, bookingData, userToken } = body;

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

    // 4. Auto-save phone + vehicle to user profile/garage if logged in
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

    // 5. Send confirmation email via Resend
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>",
          to: [bookingData.email],
          subject: "Your Booking is Confirmed — Diamond Touch Detailing",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #f5f5f5; padding: 40px; border-radius: 8px;">
              <h1 style="color: #e91e8c; font-size: 24px; margin-bottom: 8px;">You're Booked! ◆</h1>
              <p style="color: #aaa; margin-top: 0;">Your $50 deposit has been received.</p>
              <hr style="border: 1px solid #222; margin: 24px 0;" />
              <p><strong>Service:</strong> ${bookingData.service}</p>
              <p><strong>Vehicle:</strong> ${bookingData.vehicle_type}</p>
              <p><strong>Date:</strong> ${bookingData.preferred_date ?? "To be confirmed"}</p>
              <p><strong>Time:</strong> ${bookingData.preferred_time ?? "To be confirmed"}</p>
              <p><strong>Deposit Paid:</strong> $50</p>
              <hr style="border: 1px solid #222; margin: 24px 0;" />
              <p style="color: #aaa; font-size: 14px;">We'll be in touch to confirm your appointment details. Questions? Reply to this email or text us.</p>
              <p style="color: #e91e8c; font-size: 14px; margin-top: 32px;">Diamond Touch Detailing — Your Vehicle. Perfected.</p>
            </div>
          `,
        }),
      });
    } catch (emailErr) {
      console.error("Email send error:", emailErr);
      // Don't fail the booking over email
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
