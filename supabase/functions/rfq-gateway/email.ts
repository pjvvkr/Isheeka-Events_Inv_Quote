// ============================================================================
// Email adapter — swappable transactional-email sender for the RFQ gateway.
//
// Default provider: Resend (HTTPS API). To switch providers later (Brevo, SES,
// Gmail SMTP, ...), implement `send()` for the new provider and point `sendEmail`
// at it — nothing else in the gateway changes.
//
// Secrets (set via `supabase secrets set`, never in the repo):
//   RESEND_API_KEY   — your Resend API key (if unset, we run in STUB mode: the
//                      code is logged to the function logs instead of emailed,
//                      so the full loop is still testable before go-live).
//   EMAIL_FROM       — sender, e.g. "Isheeka Events <onboarding@resend.dev>"
//                      (use your verified domain address before go-live).
// ============================================================================

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "Isheeka Events <onboarding@resend.dev>";

export interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Returns { ok, stubbed } — stubbed=true means no provider key was set and the
// message was only logged (used for local/early testing).
export async function sendEmail(args: SendArgs): Promise<{ ok: boolean; stubbed: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.log("[email:STUB] no RESEND_API_KEY — not sending. Would send:", {
      to: args.to, subject: args.subject, text: args.text,
    });
    return { ok: true, stubbed: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("[email:resend] send failed", res.status, body);
      return { ok: false, stubbed: false, error: `resend ${res.status}` };
    }
    return { ok: true, stubbed: false };
  } catch (e) {
    console.error("[email:resend] exception", e);
    return { ok: false, stubbed: false, error: String(e) };
  }
}

// Branded OTP email (warm rose, matches the app/PDF identity).
export function otpEmail(code: string, refNumber: string | null): { subject: string; html: string; text: string } {
  const ref = refNumber ? ` (${refNumber})` : "";
  const subject = `Your Isheeka Events verification code: ${code}`;
  const text =
    `Your verification code for your event requirements${ref} is ${code}.\n\n` +
    `It is valid for 10 minutes. If you didn't request this, you can ignore this email.\n\n— Isheeka Events`;
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#2A2723">
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:20px;font-weight:700;letter-spacing:.04em;color:#A01044">ISHEEKA EVENTS</div>
      <div style="font-size:12px;font-style:italic;color:#B8893A">Making Every Event Memorable</div>
    </div>
    <p style="font-size:14px">Here is your verification code for your event requirements${ref}:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-size:30px;font-weight:700;letter-spacing:8px;color:#A01044;background:#FCEAF1;border-radius:10px;padding:14px 22px">${code}</span>
    </div>
    <p style="font-size:13px;color:#6B6660">This code is valid for <b>10 minutes</b>. If you didn't request it, you can safely ignore this email.</p>
    <p style="font-size:13px;color:#6B6660;margin-top:24px">— Isheeka Events</p>
  </div>`;
  return { subject, html, text };
}
