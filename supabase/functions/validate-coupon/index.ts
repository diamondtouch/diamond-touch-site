// Diamond Touch Detailing — validate-coupon edge function
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { code, amountCents, appliesTo } = await req.json();
    if (!code) return new Response(JSON.stringify({ valid: false, error: "No code provided" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: coupon, error } = await supabase
      .from("coupons")
      .select("*")
      .eq("code", code.toUpperCase().trim())
      .eq("active", true)
      .single();

    if (error || !coupon) {
      return new Response(JSON.stringify({ valid: false, error: "Invalid or expired coupon code." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return new Response(JSON.stringify({ valid: false, error: "This coupon has expired." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check max uses
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return new Response(JSON.stringify({ valid: false, error: "This coupon has reached its usage limit." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Check applies_to
    if (coupon.applies_to !== "all" && appliesTo && coupon.applies_to !== appliesTo) {
      return new Response(JSON.stringify({ valid: false, error: `This coupon only applies to ${coupon.applies_to}s.` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Calculate discount
    const originalAmount = amountCents || 0;
    let discountAmount = 0;
    if (coupon.discount_type === "percent") {
      discountAmount = Math.round(originalAmount * coupon.discount_value / 100);
    } else {
      discountAmount = Math.min(coupon.discount_value * 100, originalAmount);
    }
    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return new Response(JSON.stringify({
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      discountAmount,
      finalAmount,
      originalAmount,
      label: coupon.discount_type === "percent"
        ? `${coupon.discount_value}% off`
        : `$${(coupon.discount_value).toFixed(0)} off`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: "Server error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
