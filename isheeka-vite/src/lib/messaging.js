// Messaging helpers — WhatsApp templates, message log, send utilities.
import { supabase } from './supabase';
import { waLink } from './share.js';
import { _currentUid } from './session.js';

// WhatsApp message templates for clients
export const CLIENT_TEMPLATES = [
  { id: 'followup', label: 'Follow-up', body: (c) => `Hi ${c.first_name}, just checking in on your event plans! Feel free to reach out if you have any questions. — Team Isheeka Events` },
  { id: 'rfq_reminder', label: 'RFQ reminder', body: (c) => `Hi ${c.first_name}, a gentle reminder to fill in your event requirements: {RFQ_LINK}. — Team Isheeka Events` },
  { id: 'quote_ready', label: 'Quotation ready', body: (c) => `Hi ${c.first_name}, your quotation is ready! Please review it and let us know. — Team Isheeka Events` },
  { id: 'payment_reminder', label: 'Payment reminder', body: (c) => `Hi ${c.first_name}, this is a gentle reminder about an upcoming payment. Please reach out if you need any clarification. — Team Isheeka Events` },
  { id: 'custom', label: 'Custom message', body: () => '' },
];

// WhatsApp message templates for vendors
export const VENDOR_TEMPLATES = [
  { id: 'rfq_sent', label: 'RFQ sent', body: (v) => `Hi ${v.name}, please find the event requirements here: {RFQ_LINK}. Kindly send us your best quote. — Team Isheeka Events` },
  { id: 'quote_followup', label: 'Quote follow-up', body: (v) => `Hi ${v.name}, we are waiting for your quotation. Please send it at the earliest. — Team Isheeka Events` },
  { id: 'payment_confirm', label: 'Payment confirmation', body: (v) => `Hi ${v.name}, we have processed your payment. Please confirm receipt. — Team Isheeka Events` },
  { id: 'custom', label: 'Custom message', body: () => '' },
];

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
