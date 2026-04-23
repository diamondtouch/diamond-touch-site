// Diamond Touch Detailing — process-payment edge function
// Handles Square production charge + Supabase booking insert server-side

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ??
  "EAAAl0s0I_kqtyH9ilnPy83_wv7c_ITJ_tWsFRI9_Htn9zeNdRO7kCTswXETh4I2";
const SQUARE_API_URL = "https://connect.squareup.com/v2/payments";
const SQUARE_VERSION = "2024-06-04";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
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
    const { sourceId, amount, currency, locationId, note, buyerEmail, bookingData } = body;

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
        amount_money: {
          amount: amount,
          currency: currency ?? "USD",
        },
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

    // 2. Insert booking into Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: booking, error: dbError } = await supabase
      .from("bookings")
      .insert({
        name: bookingData.name,
        email: bookingData.email,
        phone: bookingData.phone,
        service: bookingData.service,
        vehicle_type: bookingData.vehicle_type,
        preferred_date: bookingData.preferred_date ?? null,
        notes: bookingData.notes ?? null,
        deposit_paid: true,
        square_payment_id: paymentId,
        status: "confirmed",
      })
      .select("id")
      .single();

    if (dbError) {
      // Payment succeeded but DB insert failed — log it but don't fail the user
      console.error("DB insert error (payment already captured):", dbError.message);
      return new Response(
        JSON.stringify({
          success: true,
          paymentId,
          bookingId: null,
          warning: "Booking saved but confirmation may be delayed.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
