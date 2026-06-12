# Isheeka Events ERP — Cowork Handoff
## PDF Redesign Spec + Full Fix List
**File:** `isheeka-erp-v22.html`  
**Live URL:** https://pjvvkr.github.io/Isheeka-Events_Inv_Quote/isheeka-erp-v22.html  
**Supabase project:** `https://jlcssesetnxulnkbrmyp.supabase.co`  
**Login:** `vamshi.555@gmail.com` / `Isheeka@2026`

---

## 1. App Architecture (quick recap)

- Single-file React 18 + Babel standalone HTML — **no build step**, deployed straight to GitHub Pages.
- Backend: Supabase (PostgreSQL). All schema changes are done via the Supabase SQL editor.
- Business flow: **Lead → Quotation → Event → Invoice**
- Pink-branded UI (`#e8185a` primary pink).
- PDF engine: **jsPDF + jsPDF-AutoTable** (loaded from CDN, no npm).
- PDF is generated client-side by `buildQuotationPDF(quot, lineItems, opts)`.

---

## 2. PDF Redesign — What Was Specified

The target is a **3-page branded PDF** that matches a sample design (`Test_T_Q-000044.pdf`) provided by Swathi. All decisions below are **locked**.

### Page 1 — Cover Page
| Element | Spec |
|---|---|
| Background | White |
| Border | Simple pink rect, 2.5pt, color `[232,24,90]`, 10pt inset all sides |
| Logo | Centered, large — 240×170pt at (x=(W-240)/2, y=50) |
| First divider | Pink double-line divider (see `drawDivider()`), positioned dynamically so body is vertically centered with a 40/60 top-bias split |
| Pill badge | Rounded rect, pink border 1.3pt, text `"QUOTATION · Q-26-XXXX"`, 9pt helvetica bold pink, centered |
| "PREPARED FOR" | Small caps label, 7.5pt helvetica bold, grey, letter-spacing 3, centered |
| Event name | `"Firstname Lastname's EventType"` format (already auto-built at quotation creation), 28pt helvetica bold dark, centered |
| Date | `doc_date` formatted `dd MMM yyyy`, 9pt helvetica normal grey, centered |
| Three dots | Pink filled circles — 3pt, 2pt, 3pt radius — at W/2-14, W/2, W/2+14 |
| Intro paragraph | From `settings.cover_intro` (editable in Settings UI); fallback to default text. Font: `times italic` 11pt pink, centered, line-height 15pt |
| Sign-off | `"— Swathi N, Founder & CEO"`, `times bolditalic` 11pt pink, right-aligned at W-M |
| Footer | Pink divider line only + page number (no company text) |

### Page 2 — Quotation Body
| Element | Spec |
|---|---|
| Border | Same simple pink rect |
| Header | Logo left 100×70pt at (M, 18) · Right column: "Quotation: Q-26-XXXX" bold 10pt, "Date: ..." 7.5pt grey, "Valid until: ..." 7.5pt grey · Pink divider at headerTop+68 |
| Content start | `y = 100` (below header divider) |
| Event name | 13pt helvetica bold dark |
| "CLIENT DETAILS" | Small-caps label, 7pt pink, letter-spacing 1.5 · Rounded rect box (fillColor `[255,248,250]`, stroke `[245,208,218]`) · "Shri/Smt. ClientName" 10pt bold · phone · email · city joined with " · " |
| "EVENTS & VENUES" | Small-caps label · AutoTable with columns: #, Event date, Event name, Venue, City |
| Line items table | AutoTable, pink header row, alternating grey rows. Columns depend on display options (see §3). Groups by `sub_event_name` when >1 group present and grouping=on |
| Totals | Subtotal + Discount (if enabled) + Grand Total in pink 14pt |
| Signature | Right side, `sigY = max(y+30, H*0.72)` · "Swathi" 30pt `times bolditalic` pink · "Swathi N" 10pt `times bolditalic` dark · "Founder & CEO" 8.5pt `times bolditalic` grey |
| Terms section | Conditional on available space — overflows to Page 3 if needed |

### Page 3 — Terms / Bank Details (conditional)
| Element | Spec |
|---|---|
| Trigger | Only appears if terms + bank details don't fit on Page 2 below signature |
| "PAYMENT DETAILS" | Bank name, account number, IFSC — pulled from Settings. Grey box. |
| "PAYMENT, GENERAL TERMS & CONDITIONS" | Payment schedule entries (label, pct, when) |
| "TERMS & CONDITIONS" | `additional_terms` field from quotation (multiline, bullet-prefixed) |
| Toggle | User chooses whether to include bank details via `displayOpts.bankDetails` checkbox in QuotationDetailModal |

### Display Options (checkboxes in the QuotationDetailModal)
These control what appears in the PDF. They are stored in `quotations.display_options` (JSON).

| Key | Default | Meaning |
|---|---|---|
| `coverPage` | `false` | Include the cover page |
| `prices` | `false` | Show unit price + amount columns |
| `qty` | `true` | Show Qty column |
| `grouping` | `true` | Group line items by sub-event |
| `schedule` | `true` | Show payment schedule |
| `discount` | `false` | Show discount line in totals |
| `bankDetails` | `false` | Include bank details on PDF |

Presets: **Full** (all on), **Items only** (no prices), **Summary** (name only).

### Colors & Fonts (constants in `buildQuotationPDF`)
```
PINK  = [232, 24, 90]   // primary brand pink
SPINK = [244, 114, 182] // soft pink (divider line)
DARK  = [40, 40, 40]    // near-black text
GREY  = [140, 140, 140] // secondary text

Fonts used:
  helvetica bold/normal — all body text
  times bolditalic       — signature, sign-off
  times italic           — cover intro paragraph
```

### Spacing constants
```
M = 45pt   // left/right page margin
W = 595pt  // A4 width
H = 842pt  // A4 height
```

---

## 3. PDF Redesign — Done vs. Still Pending

### ✅ DONE (all in current v22)
- [x] jsPDF + autotable CDN loaded
- [x] `buildQuotationPDF(quot, lineItems, opts)` function built — full 3-page logic
- [x] Real Isheeka logo embedded as base64 JPEG in the `LOGO` constant
- [x] Simple pink border on all pages (`drawSimpleBorder()`)
- [x] Pink double-line divider helper (`drawDivider(y)`)
- [x] Footer: divider line + page number only, no company text
- [x] Page numbers added across all pages after generation (`addPageNumbers()`)
- [x] **Cover page**: logo centered 240×170, pill badge, PREPARED FOR, event name in `"Name's EventType"` format, date, three dots, intro paragraph from settings, Swathi N sign-off in `times bolditalic`
- [x] **Cover page vertical centering**: body block height computed dynamically, positioned with 40/60 top-bias so content distributes evenly regardless of intro paragraph length
- [x] **Page 2 header**: logo 100×70 (larger than cover ratio), "Quotation: Q-26-XXXX" prefix, date + valid-until right-aligned, divider at correct position
- [x] **Page 2 content**: client details box, events & venues table, line items autotable with sub-event grouping, totals block
- [x] **Page 2 signature**: "Swathi" 30pt `times bolditalic` pink · "Swathi N" 10pt `times bolditalic` · "Founder & CEO" 8.5pt `times bolditalic` (matches cover)
- [x] Terms section with payment schedule, bank details box (conditional on `displayOpts.bankDetails`)
- [x] Page overflow: if terms don't fit Page 2, they auto-flow to Page 3 with its own header
- [x] Display options checkboxes in `QuotationDetailModal` with 3 presets (Full / Items only / Summary)
- [x] `displayOpts.coverPage` toggle controls whether Page 1 is included
- [x] `displayOpts.bankDetails` toggle controls whether bank details section renders
- [x] Bank details pulled from `settings.bank_name`, `settings.account_number`, `settings.ifsc_code`
- [x] Intro paragraph pulled from `settings.cover_intro` (editable textarea in Settings UI)
- [x] `event_name` auto-formatted as `"Firstname Lastname's EventType"` at quotation creation
- [x] Print button → `doc.autoPrint()` + open blob URL in new tab
- [x] Download button → `doc.save(filename)`
- [x] Invoice PDF path: `docType='invoice'` → header says "Invoice: INV-XXXX" (structure identical)

### ⚠️ PENDING / NOT YET TESTED
- [ ] **End-to-end PDF test** — no quotation has been fully generated and PDF downloaded in the live app yet with the new layout. The cover page, page 2, and page 3 need a visual check against the sample.
- [ ] **`client_phone` / `client_email` / `client_city` on Page 2** — these fields are enriched at wizard PDF-generation time (`enrichedQuot`) but the `QuotationDetailModal` path fetches from `quotations.*` only. Need to verify those columns exist on the quotations row or are joined from leads/clients.
- [ ] **Invoice PDF UI** — the `buildQuotationPDF` function handles `docType='invoice'` but there is no "Download Invoice" button wired up in the Invoices module yet.
- [ ] **WhatsApp share of PDF** — Step 4 of the QuoteGenerationWizard has a WhatsApp button that should share a pre-formatted message. The PDF file itself can't be attached via `whatsapp://` protocol; the button currently sends a text message only. A "share PDF link" flow (upload to storage, share URL) has not been built.
- [ ] **Template sub-event tagging** — the existing Wedding template is a flat 21-item list with no `sub_event_name` tags. The grouping feature on the PDF will not show sub-event groups until templates are re-tagged (Mehendi / Sangeet / Reception). This is a data task, not a code task — needs to be done in the Template Editor or via SQL.

---

## 4. Full v22 Fix List (all items, with status)

These were the 16 items from v21 testing + additions from the PDF redesign session.

### ✅ Done in v22
1. `getNextLeadRef()` — lead counter wired correctly (`type='lead'`)
2. `getNextClientRef()` — client counter wired correctly (`type='client'`)
3. `ClientMatchModal` — deduplication check when creating client from lead
4. `normPhone()` — phone normalisation for match detection
5. `displayOpts` persisted to `quotations.display_options` (JSON column)
6. `additional_terms` field on quotations — textarea in Step 3 of wizard, passed to PDF
7. `payment_terms_touched` guard — prevents payment terms from being overwritten if user edited them manually
8. `MAX_QTY` validation — quantity input capped in line items step
9. PDF CDN loaded — jsPDF `umd.min.js` + autotable in `<head>`
10. PDF full redesign — cover page, page 2, page 3 (described above)
11. WhatsApp share — `whatsapp://` protocol with 1.2s blur fallback to `wa.me`
12. `quote_generation_in_progress` stage — "Continue quote" on a WIP lead re-opens the existing draft instead of creating a new one
13. Tentative sub-events removed from lead creation form (they belong in the quote wizard)
14. Template filter in wizard — only shows templates matching the lead's event type
15. Cascade edits — contact field changes on lead prompt to cascade to linked quotations + client record
16. Convert-to-event flow rewrite — Lead → Quotation → Event (not Lead → Event directly)

### ⚠️ Still pending / not tested
17. `client_phone` / `client_email` / `client_city` on QuotationDetailModal PDF path (see above)
18. Invoice PDF button in Invoices module
19. Template sub-event tagging (data task)
20. End-to-end PDF visual test against sample

---

## 5. Database Schema Additions (all done in Supabase already)

```sql
-- counters table: type check now includes 'lead', 'client', 'quotation', 'invoice'
-- leads table
ALTER TABLE leads ADD COLUMN ref_number text;
-- clients table
ALTER TABLE clients ADD COLUMN ref_number text;
-- quotations table
ALTER TABLE quotations ADD COLUMN display_options jsonb;
ALTER TABLE quotations ADD COLUMN additional_terms text;
-- settings table
ALTER TABLE settings ADD COLUMN cover_intro text;
-- Counter seeds
-- lead counter seeded at 1112 (so next lead = IE-LD-1113)
-- client counter seeded at 111112 (so next client = IE-CL-111113)
-- leads_source_check updated to include: phone, whatsapp, referral, website, manual, instagram, facebook, google, walk_in, phone_call
```

---

## 6. Key Code Locations in `isheeka-erp-v22.html`

| What | Where to find it |
|---|---|
| `buildQuotationPDF()` | Search: `function buildQuotationPDF` |
| Display options checkboxes | Search: `QuotationDetailModal` |
| Settings `cover_intro` textarea | Search: `cover_intro` (in SettingsModule) |
| Quote wizard PDF call | Search: `enrichedQuot` |
| Lead-to-quotation insert | Search: `from('quotations').insert` |
| Event name formatting | Right above the insert — `event_name:(lead.last_name...` |
| WhatsApp share | Search: `whatsapp://` |
| jsPDF CDN | In `<head>` — search: `jspdf.umd.min.js` |

---

## 7. What to Work On Next (suggested priority)

1. **PDF visual test** — generate a real quotation, download the PDF, compare to sample. Fix any layout/spacing issues found.
2. **`client_phone` / `client_email` join** — ensure the QuotationDetailModal enriches `quot` with client contact details before calling `buildQuotationPDF`.
3. **Invoice PDF button** — wire up a "Download Invoice" button in the Invoices module using the same `buildQuotationPDF` with `docType='invoice'`.
4. **Template sub-event tagging** — update the Template Editor to allow tagging items by sub-event name (Mehendi/Sangeet/Reception), or do it via SQL.
5. **WhatsApp PDF link** — if needed, upload PDF blob to Supabase Storage and share the public URL via WhatsApp.
