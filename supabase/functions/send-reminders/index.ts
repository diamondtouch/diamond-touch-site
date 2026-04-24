// Diamond Touch Detailing — send-reminders
// Runs daily (via cron or manual trigger) — sends day-before and day-of reminders

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";
const RESEND_API_KEY  = "re_jUFg2vy6_2572fxadFZLiMVk9dYvBon9E";
const TWILIO_SID      = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN    = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM     = Deno.env.get("TWILIO_FROM_NUMBER");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
}

function formatTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

async function sendEmail(to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>", to: [to], subject, html }),
  });
}

async function sendSMS(phone: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) return;
  const to = phone.replace(/[^\d]/g, '').replace(/^(\d{10})$/, '+1$1');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: TWILIO_FROM, To: to, Body: body }).toString(),
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const todayStr    = today.toISOString().split('T')[0];
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Get confirmed bookings for today and tomorrow
  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, profiles(full_name, email, phone)')
    .eq('status', 'confirmed')
    .in('preferred_date', [todayStr, tomorrowStr]);

  let sent = 0;

  for (const b of (bookings || [])) {
    const isToday    = b.preferred_date === todayStr;
    const isTomorrow = b.preferred_date === tomorrowStr;
    const name    = b.profiles?.full_name || 'Valued Client';
    const email   = b.profiles?.email || null;
    const phone   = b.profiles?.phone || null;
    const service = b.service_name || 'Detail Service';
    const dateStr = formatDate(b.preferred_date);
    const timeStr = formatTime(b.preferred_time);
    const timeDisplay = timeStr ? ` at ${timeStr}` : '';

    if (isTomorrow) {
      // Day-before reminder
      const subject = `Reminder: Your Detail is Tomorrow — ${dateStr}`;
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:40px 0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#111;border-radius:12px;overflow:hidden">
  <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid #1a1a1a">
    <div style="font-size:22px;color:#e91e8c;font-weight:700;letter-spacing:.1em">◆ DIAMOND TOUCH</div>
  </td></tr>
  <tr><td style="padding:32px 40px">
    <h2 style="color:#f5f5f5;margin:0 0 16px">Your detail is tomorrow, ${name.split(' ')[0]}! 🚗</h2>
    <p style="color:#888;font-size:15px;line-height:1.6;margin:0 0 24px">Just a reminder that your Diamond Touch Detailing appointment is coming up.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px">
      <tr style="border-bottom:1px solid #1a1a1a"><td style="padding:14px 20px;color:#666;font-size:13px;width:35%">Service</td><td style="padding:14px 20px;color:#f5f5f5;font-weight:600">${service}</td></tr>
      <tr style="border-bottom:1px solid #1a1a1a"><td style="padding:14px 20px;color:#666;font-size:13px">Date</td><td style="padding:14px 20px;color:#f5f5f5">${dateStr}</td></tr>
      <tr><td style="padding:14px 20px;color:#666;font-size:13px">Time</td><td style="padding:14px 20px;color:#f5f5f5">${timeStr || 'To be confirmed'}</td></tr>
    </table>
    <p style="color:#666;font-size:13px;margin:24px 0 0">Please ensure your vehicle is accessible and there's a clear area for us to work. Questions? Reply to this email.</p>
  </td></tr>
  <tr><td style="padding:20px 40px;text-align:center;background:#0d0d0d;border-top:1px solid #1a1a1a">
    <p style="margin:0;font-size:12px;color:#444">◆ Diamond Touch Detailing — Your Vehicle. Perfected.</p>
  </td></tr>
</table></body></html>`;
      if (email) await sendEmail(email, subject, html).catch(console.error);
      if (phone) await sendSMS(phone, `◆ Diamond Touch Detailing\n\nReminder: Your detail is TOMORROW — ${dateStr}${timeDisplay}\nService: ${service}\n\nPlease ensure your vehicle is accessible. See you then!`).catch(console.error);
      sent++;
    }

    if (isToday) {
      // Day-of reminder
      const subject = `Your Detail is TODAY — ${timeStr || dateStr}`;
      const html = `<!DOCTYPE html><html><body style="margin:0;padding:40px 0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#111;border-radius:12px;overflow:hidden">
  <tr><td style="padding:32px 40px;text-align:center;border-bottom:1px solid #1a1a1a">
    <div style="font-size:22px;color:#e91e8c;font-weight:700;letter-spacing:.1em">◆ DIAMOND TOUCH</div>
  </td></tr>
  <tr><td style="padding:32px 40px">
    <h2 style="color:#f5f5f5;margin:0 0 16px">We're coming today, ${name.split(' ')[0]}! ✨</h2>
    <p style="color:#888;font-size:15px;line-height:1.6;margin:0 0 24px">Your Diamond Touch Detailing appointment is today. We can't wait to make your car shine.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px">
      <tr style="border-bottom:1px solid #1a1a1a"><td style="padding:14px 20px;color:#666;font-size:13px;width:35%">Service</td><td style="padding:14px 20px;color:#f5f5f5;font-weight:600">${service}</td></tr>
      <tr><td style="padding:14px 20px;color:#666;font-size:13px">Time</td><td style="padding:14px 20px;color:#e91e8c;font-size:18px;font-weight:700">${timeStr || 'Confirmed for today'}</td></tr>
    </table>
    <p style="color:#666;font-size:13px;margin:24px 0 0">Questions or need to reach us? Reply to this email or text us directly.</p>
  </td></tr>
  <tr><td style="padding:20px 40px;text-align:center;background:#0d0d0d;border-top:1px solid #1a1a1a">
    <p style="margin:0;font-size:12px;color:#444">◆ Diamond Touch Detailing — Your Vehicle. Perfected.</p>
  </td></tr>
</table></body></html>`;
      if (email) await sendEmail(email, subject, html).catch(console.error);
      if (phone) await sendSMS(phone, `◆ Diamond Touch Detailing\n\nYour detail is TODAY${timeDisplay}!\nService: ${service}\n\nWe're on our way — see you soon! 🚗✨`).catch(console.error);
      sent++;
    }
  }

  return new Response(JSON.stringify({ success: true, sent, todayStr, tomorrowStr }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
