// Diamond Touch Detailing — sign-contract edge function
// Records legally binding e-signature with IP, user agent, timestamp, contract version

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHash } from "https://deno.land/std@0.177.0/node/crypto.ts";

const SUPABASE_URL = "https://fjafmptbzydqizafuaru.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWZtcHRienlkcWl6YWZ1YXJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTUzMjY0NSwiZXhwIjoyMDkxMTA4NjQ1fQ.d33SmL7SpC28hZSNc6Uo5TRyUIKaILoIr13TEMXDPys";
const RESEND_API_KEY = "re_jUFg2vy6_2572fxadFZLiMVk9dYvBon9E";

// Current contract version — bump this any time contract terms change
const CONTRACT_VERSION = "DTD-MEMBERSHIP-v1.0-2026-04-23";

const CONTRACT_TEXT = `
DIAMOND TOUCH DETAILING — DIAMOND CLUB MEMBERSHIP AGREEMENT
Version: DTD-MEMBERSHIP-v1.0 | Effective: April 23, 2026

This Membership Agreement ("Agreement") is entered into between Diamond Touch Detailing ("Company") and the member identified by the electronic signature below ("Member").

1. MEMBERSHIP TERM & MINIMUM COMMITMENT
   The Diamond Club membership requires a minimum commitment of six (6) months from the start date. By signing this Agreement, Member agrees to remain enrolled for no less than six (6) consecutive months.

2. BILLING
   a) Monthly Plans: Member's payment method will be charged on the same calendar date each month. If the billing date falls on a weekend or holiday, the charge will process on the next business day.
   b) Prepay Plans: The full prepay amount is charged at the time of signup. This covers all services for the selected term (6 or 12 months).

3. SERVICES INCLUDED
   Each membership month includes one (1) Signature Detail service (full interior + exterior). Services must be used within the billing month and do not roll over.

4. EARLY CANCELLATION
   a) Monthly Plans: If Member cancels before completing the 6-month minimum commitment, Member agrees to pay the balance of remaining months in the commitment period at the agreed monthly rate. Diamond Touch Detailing reserves the right to charge Member's payment method on file for the outstanding balance.
   b) Prepay Plans: If Member cancels before the end of the prepaid term, remaining prepaid services are forfeited. No partial refunds are issued for prepaid terms.

5. CANCELLATION AFTER COMMITMENT PERIOD
   After completing the 6-month minimum commitment period, Member may cancel at any time with thirty (30) days' written notice via email to sales@diamondtouchdetails.com.

6. PRICING ADJUSTMENTS
   Diamond Touch Detailing reserves the right to adjust membership pricing with thirty (30) days' advance written notice to Member's email address on file.

7. SERVICE AREA
   Services are performed at Member's specified service address within the Diamond Touch Detailing service area (Murrieta, CA and up to 25-mile radius). Member is responsible for providing a safe, accessible location for service.

8. VEHICLE CONDITION
   Diamond Touch Detailing is not liable for pre-existing vehicle damage. Company reserves the right to photograph/video the vehicle before and after each service for quality control and marketing purposes.

9. ELECTRONIC SIGNATURE & CONSENT
   By typing their full name and checking the agreement box, Member acknowledges they have read, understand, and agree to all terms of this Agreement. This electronic signature constitutes a legally binding signature under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001) and the Uniform Electronic Transactions Act (UETA).

10. GOVERNING LAW
    This Agreement shall be governed by the laws of the State of California. Any disputes shall be resolved in Riverside County, California.

Diamond Touch Detailing
43234 Business Park Dr, Temecula, CA 92590
sales@diamondtouchdetails.com
`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { signedName, signedEmail, userToken, plan, planLabel, priceCents, commitmentMonths, billingType } = body;

    if (!signedName || !signedEmail) {
      return new Response(JSON.stringify({ success: false, error: "Name and email are required to sign." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Capture IP address (from request headers)
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || req.headers.get("cf-connecting-ip")
      || "unknown";

    const userAgent = req.headers.get("user-agent") || "unknown";
    const acceptedAt = new Date().toISOString();

    // Generate contract hash (SHA-256 of: name + email + plan + timestamp + contract text)
    const hashInput = `${signedName}|${signedEmail}|${plan}|${acceptedAt}|${CONTRACT_VERSION}`;
    const contractHash = createHash("sha256").update(hashInput).digest("hex");

    // Get user_id from token
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let userId: string | null = null;
    if (userToken) {
      try {
        const { data: { user } } = await supabase.auth.getUser(userToken);
        userId = user?.id ?? null;
      } catch (_) {}
    }

    // Insert contract record
    const { data: contract, error: dbError } = await supabase
      .from("contracts")
      .insert({
        user_id:            userId,
        contract_type:      "membership",
        contract_version:   CONTRACT_VERSION,
        signed_name:        signedName,
        signed_email:       signedEmail,
        ip_address:         ip,
        user_agent:         userAgent,
        accepted_at:        acceptedAt,
        plan:               plan,
        price_cents:        priceCents,
        commitment_months:  commitmentMonths,
        contract_hash:      contractHash,
      })
      .select("id")
      .single();

    if (dbError) {
      console.error("Contract insert error:", dbError.message);
      return new Response(JSON.stringify({ success: false, error: "Failed to record signature. Please try again." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send confirmation email with full contract
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Diamond Touch Detailing <bookings@diamondtouchdetails.com>",
          to: [signedEmail],
          subject: "Your Diamond Club Membership Agreement — Diamond Touch Detailing",
          html: `
            <div style="font-family:sans-serif;max-width:660px;margin:0 auto;background:#0a0a0a;color:#f5f5f5;padding:40px;border-radius:8px">
              <h1 style="color:#e91e8c;font-size:22px;margin-bottom:4px">Diamond Club Agreement Signed ◆</h1>
              <p style="color:#aaa;margin-top:0;font-size:14px">Please keep this email for your records.</p>
              <hr style="border:1px solid #222;margin:24px 0"/>
              <h3 style="font-size:15px;margin-bottom:12px">Signature Details</h3>
              <table style="font-size:14px;width:100%;border-collapse:collapse">
                <tr><td style="color:#888;padding:6px 0;width:160px">Signed name</td><td style="color:#f5f5f5;font-weight:600">${signedName}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Email</td><td>${signedEmail}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Plan</td><td>${planLabel}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Billing type</td><td>${billingType}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Commitment</td><td>${commitmentMonths} months</td></tr>
                <tr><td style="color:#888;padding:6px 0">Signed at</td><td>${acceptedAt} (UTC)</td></tr>
                <tr><td style="color:#888;padding:6px 0">IP address</td><td>${ip}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Contract version</td><td style="font-size:12px;color:#888">${CONTRACT_VERSION}</td></tr>
                <tr><td style="color:#888;padding:6px 0">Signature hash</td><td style="font-size:11px;color:#666;word-break:break-all">${contractHash}</td></tr>
              </table>
              <hr style="border:1px solid #222;margin:24px 0"/>
              <h3 style="font-size:15px">Full Agreement Text</h3>
              <pre style="font-size:12px;color:#aaa;white-space:pre-wrap;line-height:1.6;background:#111;padding:16px;border-radius:6px;border:1px solid #222">${CONTRACT_TEXT.trim()}</pre>
              <hr style="border:1px solid #222;margin:24px 0"/>
              <p style="font-size:13px;color:#555">This constitutes a legally binding electronic signature under the E-SIGN Act (15 U.S.C. § 7001) and UETA. Contract ID: ${contract.id}</p>
              <p style="color:#e91e8c;font-size:13px;margin-top:24px">Diamond Touch Detailing — Your Vehicle. Perfected.</p>
            </div>
          `,
        }),
      });
    } catch (emailErr) {
      console.error("Contract email error:", emailErr);
    }

    return new Response(
      JSON.stringify({ success: true, contractId: contract.id, contractHash }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("sign-contract error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Internal error. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
