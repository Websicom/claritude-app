alter table public.billing_invoices add column last_event_created_at timestamptz;
alter table public.billing_payments add column last_event_created_at timestamptz;
alter table public.billing_refunds add column last_event_created_at timestamptz;
alter table public.billing_disputes add column last_event_created_at timestamptz;
