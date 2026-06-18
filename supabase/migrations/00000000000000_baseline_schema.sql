


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."next_counter"("p_type" "text", "p_year" "text", "p_seed" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
declare
  v_next integer;
begin
  insert into counters (type, year, current_value, updated_at)
  values (p_type, p_year, p_seed, now())
  on conflict (type, year) do update
    set current_value = counters.current_value + 1,
        updated_at = now()
  returning current_value into v_next;
  return v_next;
end;
$$;


ALTER FUNCTION "public"."next_counter"("p_type" "text", "p_year" "text", "p_seed" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_rfqs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."touch_rfqs_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."alternative_contacts" (
    "contact_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "client_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "relationship" "text",
    "phone" "text",
    "email" "text",
    "notes" "text",
    "is_client" boolean DEFAULT false,
    "linked_client_id" "uuid",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "alternative_contacts_relationship_check" CHECK (("relationship" = ANY (ARRAY['spouse'::"text", 'parent'::"text", 'sibling'::"text", 'friend'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."alternative_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "client_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "phone_1" "text",
    "phone_2" "text",
    "phone_3" "text",
    "email_1" "text",
    "email_2" "text",
    "email_3" "text",
    "street_address" "text",
    "city" "text",
    "state" "text",
    "pincode" "text",
    "gst_number" "text",
    "source" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "preferred_contact" "text",
    "client_since" "date" DEFAULT CURRENT_DATE,
    "total_business_value" numeric DEFAULT 0,
    "lead_id" "uuid",
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "ref_number" "text",
    CONSTRAINT "clients_preferred_contact_check" CHECK (("preferred_contact" = ANY (ARRAY['whatsapp'::"text", 'phone'::"text", 'email'::"text"]))),
    CONSTRAINT "clients_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'vip'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."counters" (
    "counter_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "type" "text" NOT NULL,
    "year" "text" NOT NULL,
    "current_value" integer DEFAULT 1110,
    "updated_at" timestamp without time zone DEFAULT "now"(),
    CONSTRAINT "counters_type_check" CHECK (("type" = ANY (ARRAY['quotation'::"text", 'invoice'::"text", 'lead'::"text", 'client'::"text", 'event'::"text", 'rfq'::"text"])))
);


ALTER TABLE "public"."counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_checklists" (
    "checklist_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "task" "text" NOT NULL,
    "is_done" boolean DEFAULT false,
    "done_at" timestamp without time zone,
    "done_by" "uuid",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."event_checklists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_template_items" (
    "item_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "sub_event_name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "default_quantity" numeric DEFAULT 1,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."event_template_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_templates" (
    "template_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "event_type" "text",
    "is_active" boolean DEFAULT true,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."event_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_type_subevents" (
    "subevent_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type_id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_type_subevents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."event_types" (
    "event_type_id" bigint NOT NULL,
    "label" "text" NOT NULL,
    "value" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."event_types" OWNER TO "postgres";


ALTER TABLE "public"."event_types" ALTER COLUMN "event_type_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."event_types_event_type_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."event_vendors" (
    "event_vendor_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "vendor_name" "text",
    "service_description" "text",
    "agreed_amount" numeric DEFAULT 0,
    "total_paid" numeric DEFAULT 0,
    "outstanding" numeric DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "rating" numeric,
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "event_vendors_rating_check" CHECK ((("rating" >= (1)::numeric) AND ("rating" <= (5)::numeric))),
    CONSTRAINT "event_vendors_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'partially_paid'::"text", 'paid'::"text"])))
);


ALTER TABLE "public"."event_vendors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "event_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text",
    "status" "text" DEFAULT 'planning'::"text" NOT NULL,
    "main_date" "date",
    "location" "text",
    "guest_count" integer,
    "budget" numeric,
    "client_id" "uuid",
    "client_name" "text",
    "primary_contact_id" "uuid",
    "primary_contact_name" "text",
    "secondary_contact_id" "uuid",
    "secondary_contact_name" "text",
    "assigned_staff_id" "uuid",
    "assigned_staff_name" "text",
    "lead_id" "uuid",
    "internal_notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "ref_number" "text",
    "cancellation_reason" "text",
    "cancelled_at" timestamp without time zone,
    "cancelled_by" "uuid",
    CONSTRAINT "events_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'confirmed'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "expense_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "category" "text" NOT NULL,
    "sub_category" "text",
    "description" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "date" "date" NOT NULL,
    "payment_mode" "text",
    "reference_number" "text",
    "event_id" "uuid",
    "receipt_url" "text",
    "is_recurring" boolean DEFAULT false,
    "recurring_frequency" "text",
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "expenses_category_check" CHECK (("category" = ANY (ARRAY['marketing'::"text", 'operations'::"text", 'travel'::"text", 'staff'::"text", 'event_incidentals'::"text", 'professional'::"text", 'banking'::"text", 'miscellaneous'::"text"]))),
    CONSTRAINT "expenses_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['cash'::"text", 'neft'::"text", 'upi'::"text", 'cheque'::"text"]))),
    CONSTRAINT "expenses_recurring_frequency_check" CHECK (("recurring_frequency" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'yearly'::"text"])))
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_activity_log" (
    "log_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid",
    "revision_number" integer,
    "action" "text",
    "channel" "text",
    "field" "text",
    "old_value" "text",
    "new_value" "text",
    "reason" "text",
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."invoice_activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_installments" (
    "installment_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "installment_number" integer NOT NULL,
    "percentage" numeric,
    "amount_due" numeric DEFAULT 0,
    "amount_paid" numeric DEFAULT 0,
    "balance" numeric DEFAULT 0,
    "due_date" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "label" "text",
    "when_text" "text",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "invoice_installments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'partially_paid'::"text", 'paid'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."invoice_installments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_line_items" (
    "line_item_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "sub_event_id" "uuid",
    "sub_event_name" "text",
    "description" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "unit_price" numeric DEFAULT 0,
    "amount" numeric DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."invoice_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_payments" (
    "payment_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "installment_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_date" "date" NOT NULL,
    "payment_mode" "text",
    "reference_number" "text",
    "notes" "text",
    "recorded_at" timestamp without time zone DEFAULT "now"(),
    "recorded_by" "uuid",
    "receipt_url" "text",
    "is_refund" boolean DEFAULT false,
    CONSTRAINT "invoice_payments_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['cash'::"text", 'neft'::"text", 'upi'::"text", 'cheque'::"text"])))
);


ALTER TABLE "public"."invoice_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "invoice_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "ref_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_id" "uuid",
    "client_name" "text",
    "event_id" "uuid",
    "event_name" "text",
    "quotation_id" "uuid",
    "doc_date" "date" DEFAULT CURRENT_DATE,
    "subtotal" numeric DEFAULT 0,
    "grand_total" numeric DEFAULT 0,
    "total_received" numeric DEFAULT 0,
    "total_outstanding" numeric DEFAULT 0,
    "additional_notes" "text",
    "payment_terms" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "gst_applicable" boolean DEFAULT false,
    "gst_pct" numeric DEFAULT 0,
    "tax_amount" numeric DEFAULT 0,
    "discount_amount" numeric DEFAULT 0,
    "due_date" "date",
    "revision_number" integer DEFAULT 0,
    "source_quote_total" numeric DEFAULT 0,
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'partially_paid'::"text", 'paid'::"text", 'overdue'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_sources" (
    "source_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "label" "text" NOT NULL,
    "value" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."lead_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_sub_events" (
    "lead_sub_event_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "date" "date",
    "location" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "sort_order" integer DEFAULT 0,
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."lead_sub_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "lead_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "source" "text",
    "event_type" "text",
    "tentative_date" "date",
    "location" "text",
    "budget" numeric,
    "guest_count" integer,
    "stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "lost_reason" "text",
    "client_id" "uuid",
    "originated_by" "uuid",
    "assigned_to" "uuid",
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "follow_up_date" "date",
    "lost_notes" "text",
    "lost_at" timestamp without time zone,
    "converted_at" timestamp without time zone,
    "converted_by" "uuid",
    "event_id" "uuid",
    "venue_preference" "text",
    "phone_2" "text",
    "referred_by" "text",
    "active_quotation_id" "uuid",
    "ref_number" "text",
    CONSTRAINT "leads_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'quote_generation_in_progress'::"text", 'quote_sent'::"text", 'quote_revision_pending'::"text", 'revised_quote_sent'::"text", 'quote_confirmed'::"text", 'event_triggered'::"text", 'lost'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_expenses" (
    "owner_expense_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "spent_by" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "sub_category" "text",
    "description" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "date" "date" NOT NULL,
    "payment_mode" "text",
    "reference_number" "text",
    "receipt_url" "text",
    "is_historical" boolean DEFAULT false,
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "owner_expenses_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['cash'::"text", 'neft'::"text", 'upi'::"text", 'cheque'::"text"])))
);


ALTER TABLE "public"."owner_expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."owner_reimbursements" (
    "reimbursement_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "amount" numeric NOT NULL,
    "date" "date" NOT NULL,
    "payment_mode" "text",
    "reference_number" "text",
    "notes" "text",
    "recorded_at" timestamp without time zone DEFAULT "now"(),
    "recorded_by" "uuid",
    CONSTRAINT "owner_reimbursements_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['cash'::"text", 'neft'::"text", 'upi'::"text", 'cheque'::"text"])))
);


ALTER TABLE "public"."owner_reimbursements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_notifications" (
    "notification_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "installment_id" "uuid",
    "type" "text",
    "channel" "text",
    "sent_at" timestamp without time zone DEFAULT "now"(),
    "sent_by" "uuid",
    CONSTRAINT "payment_notifications_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'email'::"text", 'both'::"text"]))),
    CONSTRAINT "payment_notifications_type_check" CHECK (("type" = ANY (ARRAY['confirmation'::"text", 'reminder'::"text"])))
);


ALTER TABLE "public"."payment_notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_activity_log" (
    "log_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "channel" "text",
    "notes" "text",
    "logged_at" timestamp without time zone DEFAULT "now"(),
    "logged_by" "uuid",
    CONSTRAINT "quotation_activity_log_channel_check" CHECK (("channel" = ANY (ARRAY['whatsapp'::"text", 'email'::"text", 'phone'::"text", 'in_person'::"text", 'link'::"text"])))
);


ALTER TABLE "public"."quotation_activity_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotation_line_items" (
    "line_item_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "sub_event_id" "uuid",
    "sub_event_name" "text",
    "description" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "unit_price" numeric DEFAULT 0,
    "amount" numeric DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."quotation_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotations" (
    "quotation_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "ref_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_id" "uuid",
    "client_name" "text",
    "event_id" "uuid",
    "event_name" "text",
    "doc_date" "date" DEFAULT CURRENT_DATE,
    "valid_until" "date",
    "subtotal" numeric DEFAULT 0,
    "grand_total" numeric DEFAULT 0,
    "additional_notes" "text",
    "payment_terms" "text",
    "approval_token" "text",
    "approval_url" "text",
    "approved_at" timestamp without time zone,
    "approved_via" "text",
    "client_response_notes" "text",
    "parent_quotation_id" "uuid",
    "revision_number" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    "lead_id" "uuid",
    "discount_pct" numeric DEFAULT 0,
    "discount_amount" numeric DEFAULT 0,
    "payment_schedule" "jsonb",
    "display_options" "text",
    "additional_terms" "text",
    CONSTRAINT "quotations_approved_via_check" CHECK (("approved_via" = ANY (ARRAY['link'::"text", 'manual'::"text"]))),
    CONSTRAINT "quotations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'approved'::"text", 'revision_requested'::"text", 'revised'::"text", 'superseded'::"text", 'rejected'::"text", 'expired'::"text", 'converted'::"text", 'invoiced'::"text"])))
);


ALTER TABLE "public"."quotations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rfq_activity" (
    "activity_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rfq_id" "uuid" NOT NULL,
    "actor" "text" NOT NULL,
    "action" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rfq_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rfq_items" (
    "rfq_item_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rfq_id" "uuid" NOT NULL,
    "sub_event_name" "text",
    "description" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "unit" "text",
    "source" "text" DEFAULT 'custom'::"text",
    "sort_order" integer DEFAULT 0,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rfq_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rfq_otp" (
    "otp_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rfq_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "code_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rfq_otp" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rfqs" (
    "rfq_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ref_number" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "client_id" "uuid",
    "lead_id" "uuid",
    "event_id" "uuid",
    "quotation_id" "uuid",
    "contact_name" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "event_type" "text",
    "event_date" "date",
    "location" "text",
    "guest_count" integer,
    "budget" numeric,
    "notes" "text",
    "access_mode" "text" DEFAULT 'pin'::"text" NOT NULL,
    "access_pin_hash" "text",
    "token_hash" "text" NOT NULL,
    "token_expires_at" timestamp with time zone,
    "revision_number" integer DEFAULT 0 NOT NULL,
    "client_submitted_at" timestamp with time zone,
    "staff_approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "sub_events" "jsonb",
    "secondary_contact_name" "text",
    "secondary_contact_phone" "text",
    "city" "text",
    "budget_range" "text",
    "contact_first_name" "text",
    "contact_last_name" "text"
);


ALTER TABLE "public"."rfqs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "setting_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "company_name" "text" DEFAULT 'Isheeka Events'::"text",
    "logo_url" "text",
    "street_address" "text",
    "city" "text",
    "state" "text",
    "pincode" "text",
    "phone_1" "text",
    "phone_2" "text",
    "email" "text",
    "website" "text",
    "gst_number" "text",
    "pan_number" "text",
    "bank_name" "text",
    "account_number" "text",
    "ifsc_code" "text",
    "upi_id" "text",
    "default_validity_days" integer DEFAULT 7,
    "default_invoice_due_days" integer DEFAULT 14,
    "default_payment_schedule" "jsonb",
    "default_terms" "text",
    "signature_url" "text",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "cover_intro" "text",
    "gst_pct" numeric DEFAULT 18
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sub_event_items" (
    "item_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "sub_event_id" "uuid",
    "event_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric DEFAULT 1,
    "unit_price" numeric DEFAULT 0,
    "amount" numeric GENERATED ALWAYS AS (("quantity" * "unit_price")) STORED,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."sub_event_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sub_events" (
    "sub_event_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "date" "date",
    "location" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false
);


ALTER TABLE "public"."sub_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "role" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "profile_photo" "text",
    "date_joined" timestamp without time zone DEFAULT "now"(),
    "last_login" timestamp without time zone,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'manager'::"text", 'staff'::"text"]))),
    CONSTRAINT "users_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_installments" (
    "installment_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_vendor_id" "uuid" NOT NULL,
    "installment_number" integer NOT NULL,
    "percentage" numeric,
    "amount_due" numeric DEFAULT 0,
    "amount_paid" numeric DEFAULT 0,
    "balance" numeric DEFAULT 0,
    "due_date" "date",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp without time zone DEFAULT "now"(),
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "label" "text",
    "when_text" "text",
    CONSTRAINT "vendor_installments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'partially_paid'::"text", 'paid'::"text", 'overdue'::"text"])))
);


ALTER TABLE "public"."vendor_installments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_payments" (
    "payment_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "event_vendor_id" "uuid" NOT NULL,
    "installment_id" "uuid" NOT NULL,
    "vendor_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "payment_date" "date" NOT NULL,
    "payment_mode" "text",
    "reference_number" "text",
    "notes" "text",
    "recorded_at" timestamp without time zone DEFAULT "now"(),
    "recorded_by" "uuid",
    "is_voided" boolean DEFAULT false,
    "void_reason" "text",
    "voided_at" timestamp without time zone,
    "voided_by" "uuid",
    "is_refund" boolean DEFAULT false,
    CONSTRAINT "vendor_payments_payment_mode_check" CHECK (("payment_mode" = ANY (ARRAY['cash'::"text", 'neft'::"text", 'upi'::"text", 'cheque'::"text"])))
);


ALTER TABLE "public"."vendor_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendors" (
    "vendor_id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "contact_person" "text",
    "phone_1" "text",
    "phone_2" "text",
    "phone_3" "text",
    "email_1" "text",
    "email_2" "text",
    "email_3" "text",
    "street_address" "text",
    "city" "text",
    "state" "text",
    "gst_number" "text",
    "pan_number" "text",
    "bank_name" "text",
    "account_number" "text",
    "ifsc_code" "text",
    "upi_id" "text",
    "payment_terms" "text",
    "rating" numeric,
    "is_preferred" boolean DEFAULT false,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "created_by" "uuid",
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "uuid",
    "is_deleted" boolean DEFAULT false,
    CONSTRAINT "vendors_category_check" CHECK (("category" = ANY (ARRAY['caterer'::"text", 'decorator'::"text", 'photographer'::"text", 'sound_lighting'::"text", 'venue'::"text", 'transport'::"text", 'makeup'::"text", 'entertainment'::"text", 'other'::"text"]))),
    CONSTRAINT "vendors_rating_check" CHECK ((("rating" >= (1)::numeric) AND ("rating" <= (5)::numeric))),
    CONSTRAINT "vendors_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."vendors" OWNER TO "postgres";


ALTER TABLE ONLY "public"."alternative_contacts"
    ADD CONSTRAINT "alternative_contacts_pkey" PRIMARY KEY ("contact_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id");



ALTER TABLE ONLY "public"."counters"
    ADD CONSTRAINT "counters_pkey" PRIMARY KEY ("counter_id");



ALTER TABLE ONLY "public"."counters"
    ADD CONSTRAINT "counters_type_year_key" UNIQUE ("type", "year");



ALTER TABLE ONLY "public"."event_checklists"
    ADD CONSTRAINT "event_checklists_pkey" PRIMARY KEY ("checklist_id");



ALTER TABLE ONLY "public"."event_template_items"
    ADD CONSTRAINT "event_template_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_pkey" PRIMARY KEY ("template_id");



ALTER TABLE ONLY "public"."event_type_subevents"
    ADD CONSTRAINT "event_type_subevents_pkey" PRIMARY KEY ("subevent_id");



ALTER TABLE ONLY "public"."event_types"
    ADD CONSTRAINT "event_types_pkey" PRIMARY KEY ("event_type_id");



ALTER TABLE ONLY "public"."event_types"
    ADD CONSTRAINT "event_types_value_key" UNIQUE ("value");



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_pkey" PRIMARY KEY ("event_vendor_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("expense_id");



ALTER TABLE ONLY "public"."invoice_activity_log"
    ADD CONSTRAINT "invoice_activity_log_pkey" PRIMARY KEY ("log_id");



ALTER TABLE ONLY "public"."invoice_installments"
    ADD CONSTRAINT "invoice_installments_pkey" PRIMARY KEY ("installment_id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("line_item_id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("payment_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_ref_number_key" UNIQUE ("ref_number");



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("source_id");



ALTER TABLE ONLY "public"."lead_sub_events"
    ADD CONSTRAINT "lead_sub_events_pkey" PRIMARY KEY ("lead_sub_event_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("lead_id");



ALTER TABLE ONLY "public"."owner_expenses"
    ADD CONSTRAINT "owner_expenses_pkey" PRIMARY KEY ("owner_expense_id");



ALTER TABLE ONLY "public"."owner_reimbursements"
    ADD CONSTRAINT "owner_reimbursements_pkey" PRIMARY KEY ("reimbursement_id");



ALTER TABLE ONLY "public"."payment_notifications"
    ADD CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("notification_id");



ALTER TABLE ONLY "public"."quotation_activity_log"
    ADD CONSTRAINT "quotation_activity_log_pkey" PRIMARY KEY ("log_id");



ALTER TABLE ONLY "public"."quotation_line_items"
    ADD CONSTRAINT "quotation_line_items_pkey" PRIMARY KEY ("line_item_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_approval_token_key" UNIQUE ("approval_token");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_pkey" PRIMARY KEY ("quotation_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_ref_number_key" UNIQUE ("ref_number");



ALTER TABLE ONLY "public"."rfq_activity"
    ADD CONSTRAINT "rfq_activity_pkey" PRIMARY KEY ("activity_id");



ALTER TABLE ONLY "public"."rfq_items"
    ADD CONSTRAINT "rfq_items_pkey" PRIMARY KEY ("rfq_item_id");



ALTER TABLE ONLY "public"."rfq_otp"
    ADD CONSTRAINT "rfq_otp_pkey" PRIMARY KEY ("otp_id");



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_pkey" PRIMARY KEY ("rfq_id");



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_ref_number_key" UNIQUE ("ref_number");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("setting_id");



ALTER TABLE ONLY "public"."sub_event_items"
    ADD CONSTRAINT "sub_event_items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."sub_events"
    ADD CONSTRAINT "sub_events_pkey" PRIMARY KEY ("sub_event_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."vendor_installments"
    ADD CONSTRAINT "vendor_installments_pkey" PRIMARY KEY ("installment_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_pkey" PRIMARY KEY ("payment_id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_pkey" PRIMARY KEY ("vendor_id");



CREATE INDEX "idx_ets_event_type" ON "public"."event_type_subevents" USING "btree" ("event_type_id");



CREATE INDEX "idx_event_types_active" ON "public"."event_types" USING "btree" ("is_active", "sort_order");



CREATE INDEX "idx_invoice_activity_log_invoice" ON "public"."invoice_activity_log" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_installments_due" ON "public"."invoice_installments" USING "btree" ("due_date");



CREATE INDEX "idx_invoice_installments_invoice" ON "public"."invoice_installments" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_line_items_invoice" ON "public"."invoice_line_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_payments_invoice" ON "public"."invoice_payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoices_event" ON "public"."invoices" USING "btree" ("event_id");



CREATE INDEX "idx_rfq_activity_rfq_id" ON "public"."rfq_activity" USING "btree" ("rfq_id");



CREATE INDEX "idx_rfq_items_rfq_id" ON "public"."rfq_items" USING "btree" ("rfq_id");



CREATE INDEX "idx_rfq_otp_rfq_id" ON "public"."rfq_otp" USING "btree" ("rfq_id");



CREATE INDEX "idx_rfqs_client_id" ON "public"."rfqs" USING "btree" ("client_id");



CREATE INDEX "idx_rfqs_event_id" ON "public"."rfqs" USING "btree" ("event_id");



CREATE INDEX "idx_rfqs_lead_id" ON "public"."rfqs" USING "btree" ("lead_id");



CREATE INDEX "idx_rfqs_status" ON "public"."rfqs" USING "btree" ("status");



CREATE INDEX "idx_rfqs_token_hash" ON "public"."rfqs" USING "btree" ("token_hash");



CREATE OR REPLACE TRIGGER "trg_rfqs_touch" BEFORE UPDATE ON "public"."rfqs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_rfqs_updated_at"();



ALTER TABLE ONLY "public"."alternative_contacts"
    ADD CONSTRAINT "alternative_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."alternative_contacts"
    ADD CONSTRAINT "alternative_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."alternative_contacts"
    ADD CONSTRAINT "alternative_contacts_linked_client_id_fkey" FOREIGN KEY ("linked_client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."event_checklists"
    ADD CONSTRAINT "event_checklists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."event_checklists"
    ADD CONSTRAINT "event_checklists_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."event_checklists"
    ADD CONSTRAINT "event_checklists_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."event_template_items"
    ADD CONSTRAINT "event_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."event_templates"("template_id");



ALTER TABLE ONLY "public"."event_templates"
    ADD CONSTRAINT "event_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."event_type_subevents"
    ADD CONSTRAINT "event_type_subevents_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("event_type_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."event_vendors"
    ADD CONSTRAINT "event_vendors_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("vendor_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_primary_contact_id_fkey" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."alternative_contacts"("contact_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_secondary_contact_id_fkey" FOREIGN KEY ("secondary_contact_id") REFERENCES "public"."alternative_contacts"("contact_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."invoice_activity_log"
    ADD CONSTRAINT "invoice_activity_log_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id");



ALTER TABLE ONLY "public"."invoice_installments"
    ADD CONSTRAINT "invoice_installments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id");



ALTER TABLE ONLY "public"."invoice_line_items"
    ADD CONSTRAINT "invoice_line_items_sub_event_id_fkey" FOREIGN KEY ("sub_event_id") REFERENCES "public"."sub_events"("sub_event_id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "public"."invoice_installments"("installment_id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."lead_sub_events"
    ADD CONSTRAINT "lead_sub_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_active_quotation_id_fkey" FOREIGN KEY ("active_quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_converted_by_fkey" FOREIGN KEY ("converted_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."owner_expenses"
    ADD CONSTRAINT "owner_expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."owner_expenses"
    ADD CONSTRAINT "owner_expenses_spent_by_fkey" FOREIGN KEY ("spent_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."owner_reimbursements"
    ADD CONSTRAINT "owner_reimbursements_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."payment_notifications"
    ADD CONSTRAINT "payment_notifications_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "public"."invoice_installments"("installment_id");



ALTER TABLE ONLY "public"."payment_notifications"
    ADD CONSTRAINT "payment_notifications_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id");



ALTER TABLE ONLY "public"."payment_notifications"
    ADD CONSTRAINT "payment_notifications_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."quotation_activity_log"
    ADD CONSTRAINT "quotation_activity_log_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."quotation_activity_log"
    ADD CONSTRAINT "quotation_activity_log_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."quotation_line_items"
    ADD CONSTRAINT "quotation_line_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."quotation_line_items"
    ADD CONSTRAINT "quotation_line_items_sub_event_id_fkey" FOREIGN KEY ("sub_event_id") REFERENCES "public"."sub_events"("sub_event_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_parent_quotation_id_fkey" FOREIGN KEY ("parent_quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."rfq_activity"
    ADD CONSTRAINT "rfq_activity_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("rfq_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rfq_items"
    ADD CONSTRAINT "rfq_items_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("rfq_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rfq_otp"
    ADD CONSTRAINT "rfq_otp_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "public"."rfqs"("rfq_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("client_id");



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("lead_id");



ALTER TABLE ONLY "public"."rfqs"
    ADD CONSTRAINT "rfqs_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("quotation_id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."sub_event_items"
    ADD CONSTRAINT "sub_event_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."sub_event_items"
    ADD CONSTRAINT "sub_event_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."sub_event_items"
    ADD CONSTRAINT "sub_event_items_sub_event_id_fkey" FOREIGN KEY ("sub_event_id") REFERENCES "public"."sub_events"("sub_event_id");



ALTER TABLE ONLY "public"."sub_events"
    ADD CONSTRAINT "sub_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."sub_events"
    ADD CONSTRAINT "sub_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."vendor_installments"
    ADD CONSTRAINT "vendor_installments_event_vendor_id_fkey" FOREIGN KEY ("event_vendor_id") REFERENCES "public"."event_vendors"("event_vendor_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."events"("event_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_event_vendor_id_fkey" FOREIGN KEY ("event_vendor_id") REFERENCES "public"."event_vendors"("event_vendor_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "public"."vendor_installments"("installment_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."vendor_payments"
    ADD CONSTRAINT "vendor_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("vendor_id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."vendors"
    ADD CONSTRAINT "vendors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("user_id");



CREATE POLICY "Admins can manage users" ON "public"."users" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Users can view all users" ON "public"."users" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "alt_contacts_policy" ON "public"."alternative_contacts" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."alternative_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_policy" ON "public"."clients" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."counters" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "counters_policy" ON "public"."counters" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "ets_auth_all" ON "public"."event_type_subevents" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."event_checklists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_checklists_policy" ON "public"."event_checklists" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."event_template_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_template_items_policy" ON "public"."event_template_items" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."event_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_templates_policy" ON "public"."event_templates" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."event_type_subevents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_types_all" ON "public"."event_types" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."event_vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_vendors_policy" ON "public"."event_vendors" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_policy" ON "public"."events" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "expenses_policy" ON "public"."expenses" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invoice_activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_activity_log_all" ON "public"."invoice_activity_log" USING (("auth"."role"() = 'authenticated'::"text")) WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invoice_installments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_installments_policy" ON "public"."invoice_installments" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_line_items_policy" ON "public"."invoice_line_items" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_payments_policy" ON "public"."invoice_payments" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_policy" ON "public"."invoices" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."lead_sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_sources_policy" ON "public"."lead_sources" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."lead_sub_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_sub_events_policy" ON "public"."lead_sub_events" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_policy" ON "public"."leads" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."owner_expenses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner_expenses_policy" ON "public"."owner_expenses" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."owner_reimbursements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner_reimbursements_policy" ON "public"."owner_reimbursements" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."payment_notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_notifications_policy" ON "public"."payment_notifications" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."quotation_activity_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quotation_activity_log_policy" ON "public"."quotation_activity_log" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."quotation_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quotation_line_items_policy" ON "public"."quotation_line_items" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."quotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quotations_policy" ON "public"."quotations" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."rfq_activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rfq_activity_auth_all" ON "public"."rfq_activity" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."rfq_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rfq_items_auth_all" ON "public"."rfq_items" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."rfq_otp" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rfq_otp_auth_all" ON "public"."rfq_otp" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."rfqs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rfqs_auth_all" ON "public"."rfqs" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "settings_policy" ON "public"."settings" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."sub_event_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sub_event_items_policy" ON "public"."sub_event_items" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."sub_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sub_events_policy" ON "public"."sub_events" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_installments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_installments_policy" ON "public"."vendor_installments" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."vendor_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendor_payments_policy" ON "public"."vendor_payments" USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."vendors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vendors_policy" ON "public"."vendors" USING (("auth"."role"() = 'authenticated'::"text"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."next_counter"("p_type" "text", "p_year" "text", "p_seed" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."next_counter"("p_type" "text", "p_year" "text", "p_seed" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_counter"("p_type" "text", "p_year" "text", "p_seed" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_rfqs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_rfqs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_rfqs_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."alternative_contacts" TO "anon";
GRANT ALL ON TABLE "public"."alternative_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."alternative_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."counters" TO "anon";
GRANT ALL ON TABLE "public"."counters" TO "authenticated";
GRANT ALL ON TABLE "public"."counters" TO "service_role";



GRANT ALL ON TABLE "public"."event_checklists" TO "anon";
GRANT ALL ON TABLE "public"."event_checklists" TO "authenticated";
GRANT ALL ON TABLE "public"."event_checklists" TO "service_role";



GRANT ALL ON TABLE "public"."event_template_items" TO "anon";
GRANT ALL ON TABLE "public"."event_template_items" TO "authenticated";
GRANT ALL ON TABLE "public"."event_template_items" TO "service_role";



GRANT ALL ON TABLE "public"."event_templates" TO "anon";
GRANT ALL ON TABLE "public"."event_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."event_templates" TO "service_role";



GRANT ALL ON TABLE "public"."event_type_subevents" TO "anon";
GRANT ALL ON TABLE "public"."event_type_subevents" TO "authenticated";
GRANT ALL ON TABLE "public"."event_type_subevents" TO "service_role";



GRANT ALL ON TABLE "public"."event_types" TO "anon";
GRANT ALL ON TABLE "public"."event_types" TO "authenticated";
GRANT ALL ON TABLE "public"."event_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."event_types_event_type_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."event_types_event_type_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."event_types_event_type_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."event_vendors" TO "anon";
GRANT ALL ON TABLE "public"."event_vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."event_vendors" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON TABLE "public"."expenses" TO "anon";
GRANT ALL ON TABLE "public"."expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."expenses" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."invoice_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_installments" TO "anon";
GRANT ALL ON TABLE "public"."invoice_installments" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_installments" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_line_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_payments" TO "anon";
GRANT ALL ON TABLE "public"."invoice_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_payments" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON TABLE "public"."lead_sources" TO "anon";
GRANT ALL ON TABLE "public"."lead_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_sources" TO "service_role";



GRANT ALL ON TABLE "public"."lead_sub_events" TO "anon";
GRANT ALL ON TABLE "public"."lead_sub_events" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_sub_events" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."owner_expenses" TO "anon";
GRANT ALL ON TABLE "public"."owner_expenses" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_expenses" TO "service_role";



GRANT ALL ON TABLE "public"."owner_reimbursements" TO "anon";
GRANT ALL ON TABLE "public"."owner_reimbursements" TO "authenticated";
GRANT ALL ON TABLE "public"."owner_reimbursements" TO "service_role";



GRANT ALL ON TABLE "public"."payment_notifications" TO "anon";
GRANT ALL ON TABLE "public"."payment_notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_notifications" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."quotation_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_line_items" TO "anon";
GRANT ALL ON TABLE "public"."quotation_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."quotations" TO "anon";
GRANT ALL ON TABLE "public"."quotations" TO "authenticated";
GRANT ALL ON TABLE "public"."quotations" TO "service_role";



GRANT ALL ON TABLE "public"."rfq_activity" TO "anon";
GRANT ALL ON TABLE "public"."rfq_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."rfq_activity" TO "service_role";



GRANT ALL ON TABLE "public"."rfq_items" TO "anon";
GRANT ALL ON TABLE "public"."rfq_items" TO "authenticated";
GRANT ALL ON TABLE "public"."rfq_items" TO "service_role";



GRANT ALL ON TABLE "public"."rfq_otp" TO "anon";
GRANT ALL ON TABLE "public"."rfq_otp" TO "authenticated";
GRANT ALL ON TABLE "public"."rfq_otp" TO "service_role";



GRANT ALL ON TABLE "public"."rfqs" TO "anon";
GRANT ALL ON TABLE "public"."rfqs" TO "authenticated";
GRANT ALL ON TABLE "public"."rfqs" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."sub_event_items" TO "anon";
GRANT ALL ON TABLE "public"."sub_event_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_event_items" TO "service_role";



GRANT ALL ON TABLE "public"."sub_events" TO "anon";
GRANT ALL ON TABLE "public"."sub_events" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_events" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_installments" TO "anon";
GRANT ALL ON TABLE "public"."vendor_installments" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_installments" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_payments" TO "anon";
GRANT ALL ON TABLE "public"."vendor_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_payments" TO "service_role";



GRANT ALL ON TABLE "public"."vendors" TO "anon";
GRANT ALL ON TABLE "public"."vendors" TO "authenticated";
GRANT ALL ON TABLE "public"."vendors" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































