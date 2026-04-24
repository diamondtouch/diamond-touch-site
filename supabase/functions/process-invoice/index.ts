// Diamond Touch Detailing — process-invoice edge function
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";
const SQUARE_TOKEN = "EAAAl0s0I_kqtyH9ilnPy83_wv7c_ITJ_tWsFRI9_Htn9zeNdRO7kCTswXETh4I2";
const SQUARE_LOCATION = "LE683QS3VSGN7";
const RESEND_KEY = "re_jUFg2vy6_2572fxadFZLiMVk9dYvBon9E";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function shortCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function fmtDate(d: string) {
  return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", year:"numeric" });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // GET — fetch invoice by code (for invoice page)
  if (req.method === "GET") {
    const code = new URL(req.url).searchParams.get("code");
    if (!code) return new Response(JSON.stringify({ error: "No code" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: inv } = await supabase
      .from("invoices").select("*, bookings(*)").eq("short_code", code).single();

    if (!inv) return new Response(JSON.stringify({ error: "Invoice not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    // Mark as viewed if still sent
    if (inv.status === "sent") {
      await supabase.from("invoices").update({ status: "viewed" }).eq("id", inv.id);
    }

    return new Response(JSON.stringify({ success: true, invoice: inv }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const body = await req.json();
  const { action } = body;

  // ── CREATE INVOICE ──────────────────────────────────────────
  if (action === "create") {
    const { bookingId, adminToken } = body;

    // Auth check
    if (!adminToken) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    // Fetch booking
    const { data: booking } = await supabase.from("bookings").select("*, profiles(full_name,email,phone)").eq("id", bookingId).single();
    if (!booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const balance = Math.max(0, (booking.total_amount || 0) - (booking.deposit_amount || 5000));
    const taxCents = booking.tax_cents || 0;
    const clientEmail = booking.profiles?.email || (booking.notes?.match(/Email:\s*([^\s|]+)/)?.[1]) || "";
    const clientName = booking.profiles?.full_name || (booking.notes?.match(/Customer:\s*([^|]+)/)?.[1]?.trim()) || "Valued Client";

    // Check if invoice already exists for this booking — reuse it
    const { data: existingInv } = await supabase.from("invoices").select("id,short_code,status").eq("booking_id", bookingId).single();

    let invoiceId: string;
    let code: string;

    if (existingInv) {
      // Reuse existing invoice — just resend the email
      invoiceId = existingInv.id;
      code = existingInv.short_code;
      // Reset status to "sent" if it was viewed but unpaid (keeps it active)
      if (existingInv.status !== "paid") {
        await supabase.from("invoices").update({ status: "sent" }).eq("id", invoiceId);
      }
    } else {
      // Create new invoice
      let newCode = shortCode();
      let attempt = 0;
      while (attempt < 5) {
        const { data: taken } = await supabase.from("invoices").select("id").eq("short_code", newCode).single();
        if (!taken) break;
        newCode = shortCode();
        attempt++;
      }
      code = newCode;
      const { data: newInv, error: invErr } = await supabase.from("invoices").insert({
        booking_id: bookingId,
        user_id: booking.user_id,
        short_code: code,
        amount_cents: balance,
        tax_cents: taxCents,
        status: "sent",
        sent_to_email: clientEmail,
      }).select("id").single();
      if (invErr) return new Response(JSON.stringify({ error: invErr.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      invoiceId = newInv.id;
    }

    const invoiceUrl = `https://diamondtouchdetails.com/invoice.html?code=${code}`;
    const isResend = !!existingInv;

    // Send email
    if (clientEmail) {
      const balanceFmt = (balance / 100).toFixed(2);
      const taxFmt = taxCents > 0 ? (taxCents / 100).toFixed(2) : null;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>",
          to: [clientEmail],
          subject: "Your Diamond Touch Invoice — Pay Securely Online",
          html: `<!DOCTYPE html><html><body style="margin:0;padding:40px 0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#111;border-radius:12px;overflow:hidden">
  <tr><td style="padding:28px 32px;text-align:center;border-bottom:1px solid #1a1a1a">
    <div style="font-size:20px;color:#e91e8c;font-weight:700;letter-spacing:.12em">&#9670; DIAMOND TOUCH DETAILING</div>
  </td></tr>
  <tr><td style="padding:32px;text-align:center">
    <h1 style="color:#f5f5f5;font-size:22px;margin:0 0 8px">Your service is complete!</h1>
    <p style="color:#888;font-size:14px;margin:0">Here is your invoice. Pay securely online in seconds.</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px">
      <tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Service</td><td style="padding:14px 20px;font-size:14px;color:#f5f5f5;font-weight:600;border-bottom:1px solid #1a1a1a">${booking.service_name||"Detail Service"}</td></tr>
      <tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Vehicle</td><td style="padding:14px 20px;font-size:14px;color:#f5f5f5;border-bottom:1px solid #1a1a1a;text-transform:capitalize">${booking.vehicle_type||""}</td></tr>
      <tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Date</td><td style="padding:14px 20px;font-size:14px;color:#f5f5f5;border-bottom:1px solid #1a1a1a">${booking.preferred_date ? fmtDate(booking.preferred_date) : "—"}</td></tr>
      ${taxFmt ? `<tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Tax</td><td style="padding:14px 20px;font-size:14px;color:#f5f5f5;border-bottom:1px solid #1a1a1a">$${taxFmt}</td></tr>` : ""}
      <tr style="background:#0a0a0a"><td style="padding:16px 20px;font-size:15px;font-weight:700;color:#f5f5f5">Balance Due</td><td style="padding:16px 20px;font-size:22px;font-weight:700;color:#e91e8c">$${balanceFmt}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 32px 28px;text-align:center">
    <p style="color:#666;font-size:13px;margin:0 0 20px">Tips are always appreciated and go directly to your detailer &#9829;</p>
    <a href="${invoiceUrl}" style="display:inline-block;background:#e91e8c;color:#fff;text-decoration:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700">Pay Invoice &amp; Tip &rarr;</a>
  </td></tr>
  <tr><td style="padding:20px 32px;text-align:center;background:#0d0d0d;border-top:1px solid #1a1a1a">
    <p style="margin:0;font-size:12px;color:#444">&#9670; Diamond Touch Detailing &mdash; Your Vehicle. Perfected. &bull; (951) 345-3195</p>
  </td></tr>
</table></body></html>`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, invoiceId, shortCode: code, invoiceUrl, isResend }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // ── PAY INVOICE ─────────────────────────────────────────────
  if (action === "pay") {
    const { shortCode: code, sourceId, tipCents = 0 } = body;

    const { data: inv } = await supabase.from("invoices").select("*, bookings(service_name,vehicle_type,preferred_date,user_id)").eq("short_code", code).single();
    if (!inv) return new Response(JSON.stringify({ success: false, error: "Invoice not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    if (inv.status === "paid") return new Response(JSON.stringify({ success: false, error: "Already paid" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const totalCents = inv.amount_cents + inv.tax_cents + Math.max(0, tipCents);

    let paymentId = null;
    if (totalCents > 0 && sourceId) {
      const squareRes = await fetch("https://connect.squareup.com/v2/payments", {
        method: "POST",
        headers: { "Authorization": `Bearer ${SQUARE_TOKEN}`, "Square-Version": "2024-06-04", "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: `inv-${code}-${Date.now()}`,
          source_id: sourceId,
          amount_money: { amount: totalCents, currency: "USD" },
          location_id: SQUARE_LOCATION,
          note: `Diamond Touch invoice ${code} — balance + tip`,
          buyer_email_address: inv.sent_to_email,
        }),
      });
      const sqData = await squareRes.json();
      if (!squareRes.ok || sqData.errors) {
        return new Response(JSON.stringify({ success: false, error: sqData.errors?.[0]?.detail || "Payment failed" }), { status: 402, headers: { ...cors, "Content-Type": "application/json" } });
      }
      paymentId = sqData.payment?.id;
    }

    await supabase.from("invoices").update({
      status: "paid",
      tip_cents: tipCents,
      total_paid_cents: totalCents,
      square_payment_id: paymentId,
      paid_at: new Date().toISOString(),
    }).eq("id", inv.id);

    // Thank-you email
    if (inv.sent_to_email) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>",
          to: [inv.sent_to_email],
          subject: "Payment Received — Thank You! ◆",
          html: `<!DOCTYPE html><html><body style="margin:0;padding:40px 0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#111;border-radius:12px;overflow:hidden">
  <tr><td style="padding:28px 32px;text-align:center;border-bottom:1px solid #1a1a1a"><div style="font-size:20px;color:#e91e8c;font-weight:700;letter-spacing:.12em">&#9670; DIAMOND TOUCH DETAILING</div></td></tr>
  <tr><td style="padding:32px;text-align:center">
    <div style="font-size:40px;margin-bottom:12px">&#10003;</div>
    <h1 style="color:#f5f5f5;font-size:22px;margin:0 0 8px">Payment Received!</h1>
    <p style="color:#888;font-size:14px;margin:0">Thank you for your business. We appreciate you!</p>
  </td></tr>
  <tr><td style="padding:0 32px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px">
      <tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Balance paid</td><td style="padding:14px 20px;font-size:14px;color:#f5f5f5;border-bottom:1px solid #1a1a1a">$${(inv.amount_cents/100).toFixed(2)}</td></tr>
      ${tipCents > 0 ? `<tr><td style="padding:14px 20px;font-size:13px;color:#666;border-bottom:1px solid #1a1a1a">Tip &#9829;</td><td style="padding:14px 20px;font-size:14px;color:#4ade80;border-bottom:1px solid #1a1a1a">$${(tipCents/100).toFixed(2)}</td></tr>` : ""}
      <tr style="background:#0a0a0a"><td style="padding:16px 20px;font-size:15px;font-weight:700;color:#f5f5f5">Total charged</td><td style="padding:16px 20px;font-size:18px;font-weight:700;color:#4ade80">$${(totalCents/100).toFixed(2)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 32px;text-align:center;background:#0d0d0d;border-top:1px solid #1a1a1a"><p style="margin:0;font-size:12px;color:#444">&#9670; Diamond Touch Detailing &mdash; Your Vehicle. Perfected.</p></td></tr>
</table></body></html>`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({ success: true, totalCharged: totalCents, paymentId }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
});
