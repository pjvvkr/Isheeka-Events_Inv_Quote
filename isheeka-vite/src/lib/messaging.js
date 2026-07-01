// Messaging helpers — WhatsApp templates, message log, send utilities.
import { supabase } from './supabase';
import { waLink } from './share.js';
import { _currentUid } from './session.js';

// WhatsApp message templates for clients (the "Dear {name}," salutation is added by the modal from context)
export const CLIENT_TEMPLATES = [
  { id: 'followup', label: 'Follow-up', body: () => `Just checking in on your event plans! Feel free to reach out if you have any questions.` },
  { id: 'rfq_reminder', label: 'RFQ reminder', body: () => `A gentle reminder to fill in your event requirements: {RFQ_LINK}.` },
  { id: 'quote_ready', label: 'Quotation ready', body: () => `Your quotation is ready! Please review it and let us know.` },
  { id: 'payment_reminder', label: 'Payment reminder', body: () => `This is a gentle reminder about an upcoming payment. Please reach out if you need any clarification.` },
  { id: 'custom', label: 'Custom message', body: () => '' },
];

// WhatsApp message templates for vendors (the "Dear {name}," salutation is added by the modal from context)
export const VENDOR_TEMPLATES = [
  { id: 'rfq_sent', label: 'RFQ sent', body: () => `Please find the event requirements here: {RFQ_LINK}. Kindly send us your best quote.` },
  { id: 'quote_followup', label: 'Quote follow-up', body: () => `We are waiting for your quotation. Please send it at the earliest.` },
  { id: 'payment_confirm', label: 'Payment confirmation', body: () => `We have processed your payment. Please confirm receipt.` },
  { id: 'custom', label: 'Custom message', body: () => '' },
];

// Isheeka branded sign-off, built from Settings (company + contacts). Appended to client messages.
export function brandFooter(s) {
  s = s || {};
  const lines = ['For any queries, please reach out to us at:'];
  if (s.phone_1) lines.push('\ud83d\udcde ' + s.phone_1);
  if (s.email) lines.push('\u2709\ufe0f ' + s.email);
  if (s.website) lines.push('\ud83c\udf10 ' + s.website);
  lines.push('');
  lines.push('Warm regards,');
  lines.push('Team ' + (s.company_name || 'Isheeka Events') + ' \ud83d\udc95');
  return lines.join('\n');
}

// Log a sent message to message_log table
export async function logMessage({ party_type, party_id, channel, template, body }) {
  const uid = await _currentUid();
  await supabase.from('message_log').insert({ party_type, party_id, channel, template: template || null, body: body || null, sent_by: uid || null });
}

// Send WhatsApp (opens wa.me link) and log it
export function sendWhatsApp({ phone, body, party_type, party_id, template }) {
  if (phone) window.open(waLink(phone, body), '_blank');
  logMessage({ party_type, party_id, channel: 'whatsapp', template, body }).catch(() => {});
}

// Log an email send to message_log (email is sent through Resend on gateway side)
export async function logEmail({ to, subject, body, party_type, party_id, template }) {
  await logMessage({ party_type, party_id, channel: 'email', template, body: `To: ${to}\nSubject: ${subject}\n\n${body}` });
}
