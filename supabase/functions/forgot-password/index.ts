// Forgot Password — Edge Function
// ============================================================================
// POST { email: string }
//
// Flow (email first, password second, so a failed email never locks anyone
// out):
//   1. No RESEND_API_KEY → answer 503 and change nothing; the app then tells
//      the person to ask an administrator.
//   2. password_reset_account(email): whose address it is. Changes nothing.
//   3. Make up a temporary password and email it through Resend.
//   4. Only if Resend accepted the email: apply_password_reset(email, password)
//      sets it (PENDING, sessions ended, logged).
// Both database functions are callable by the service role only (migration
// 20261110133241_forgot_password_email_first), never by the browser.
//
// The answer is the same generic message whether or not the address has an
// account, so the endpoint cannot be used to find out who has one.
//
// Who may call it: anyone (it is the page before login). Deploy with
//   npx supabase@2 functions deploy forgot-password --no-verify-jwt
// so the app's key, old style (eyJ…) or new (sb_publishable_…), is never
// checked here. Set the email key once:
//   Dashboard → Edge Functions → Secrets → RESEND_API_KEY
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the Edge Runtime.
//
// Resend's free sender (onboarding@resend.dev) delivers only to the address
// that owns the Resend account until a domain is verified there. To anyone
// else the send is refused, and with this order their password stays as it was.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a temporary password to it.";

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// 12 characters, letters and digits, no look-alikes (0/O, 1/l/I); always at
// least one letter and one digit, which the password rule needs.
function temporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  chars[bytes[0] % 6] = letters[bytes[1] % letters.length];
  chars[6 + (bytes[2] % 6)] = digits[bytes[3] % digits.length];
  return chars.join("");
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const { email } = await req.json().catch(() => ({}));
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return reply({ error: "Email is required." }, 400);
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("RESEND_API_KEY is not set — cannot send email. No password was changed.");
      return reply({ error: "Password reset by email is not set up." }, 503);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data: account, error: lookupError } = await supabaseAdmin
      .rpc("password_reset_account", { target_email: email.trim() })
      .maybeSingle();
    if (lookupError) {
      console.error("password_reset_account failed:", lookupError);
      return reply({ message: GENERIC_MESSAGE });
    }
    if (!account) return reply({ message: GENERIC_MESSAGE });

    const password = temporaryPassword();
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Resend's shared sender until a domain is verified in Resend.
        from: "Torres Pest Control <onboarding@resend.dev>",
        to: [account.user_email],
        subject: "Your temporary password — Torres Pest Control",
        html: `
          <p>Hi ${escapeHtml(account.user_name || "")},</p>
          <p>Here's a temporary password to get back into your account:</p>
          <p style="font-size: 1.25rem; font-weight: 700; letter-spacing: 0.05em;">${password}</p>
          <p>Log in with it, then go to <strong>Settings &gt; Change Password</strong>
          to set a password only you know.</p>
          <p>If you didn't request this, contact an administrator.</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      console.error("Resend refused the email; the password was NOT changed:", emailResponse.status, await emailResponse.text());
      return reply({ message: GENERIC_MESSAGE });
    }

    const { error: applyError } = await supabaseAdmin.rpc("apply_password_reset", {
      target_email: email.trim(),
      new_password: password,
    });
    if (applyError) {
      // The email went out but the old password still works; nobody is locked out.
      console.error("apply_password_reset failed after the email was sent:", applyError);
    }

    return reply({ message: GENERIC_MESSAGE });
  } catch (err) {
    console.error("forgot-password error:", err);
    return reply({ message: GENERIC_MESSAGE });
  }
});
