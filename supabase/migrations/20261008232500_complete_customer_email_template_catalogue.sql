insert into public.email_templates(
  template_key, version, subject, html_body, text_body, variables, state,
  description, provider_managed, sending_path, published_at
)
values
  ('welcome', 1, 'Welcome to Claritude', '<p>Welcome {{accountName}}.</p>', 'Welcome {{accountName}}.', array['accountName'], 'active', 'Welcome email after account creation.', false, 'Claritude account lifecycle', now()),
  ('inactivity_60', 1, 'Your Claritude account has been inactive for 60 days', '<p>{{accountName}} has been inactive for 60 days. Sign in to keep the account active.</p>', '{{accountName}} has been inactive for 60 days. Sign in to keep the account active.', array['accountName'], 'active', 'First free-account inactivity warning.', false, 'Claritude free-account inactivity lifecycle', now()),
  ('inactivity_90', 1, 'Reminder: your Claritude account is inactive', '<p>{{accountName}} has been inactive for 90 days and is approaching a reversible freeze.</p>', '{{accountName}} has been inactive for 90 days and is approaching a reversible freeze.', array['accountName'], 'active', 'Second free-account inactivity warning.', false, 'Claritude free-account inactivity lifecycle', now()),
  ('inactivity_freeze', 1, 'Your Claritude account has been frozen', '<p>{{accountName}} was reversibly frozen after 100 days of inactivity.</p>', '{{accountName}} was reversibly frozen after 100 days of inactivity.', array['accountName'], 'active', 'Free-account inactivity freeze notice.', false, 'Claritude free-account inactivity lifecycle', now()),
  ('manual_freeze', 1, 'Your Claritude account has been paused', '<p>{{accountName}} was paused by Claritude support. Reason: {{reason}}</p>', '{{accountName}} was paused by Claritude support. Reason: {{reason}}', array['accountName','reason'], 'active', 'Manual account freeze notice.', false, 'Claritude account controls', now()),
  ('deletion_eligible', 1, 'Your Claritude account requires deletion review', '<p>{{accountName}} has reached deletion eligibility. No irreversible deletion is automatic.</p>', '{{accountName}} has reached deletion eligibility. No irreversible deletion is automatic.', array['accountName'], 'active', 'Free-account deletion eligibility notice.', false, 'Claritude free-account inactivity lifecycle', now()),
  ('payment_receipt', 1, 'Claritude payment received', '<p>We received {{amount}} for {{accountName}}. Invoice: {{invoiceNumber}}</p>', 'We received {{amount}} for {{accountName}}. Invoice: {{invoiceNumber}}', array['amount','accountName','invoiceNumber'], 'active', 'Claritude payment receipt wrapper; Stripe remains authoritative for payment state.', false, 'Verified Stripe webhook notification', now()),
  ('invoice_available', 1, 'Your Claritude invoice is available', '<p>Invoice {{invoiceNumber}} for {{accountName}} is available.</p>', 'Invoice {{invoiceNumber}} for {{accountName}} is available.', array['accountName','invoiceNumber'], 'active', 'Invoice availability notification.', false, 'Verified Stripe webhook notification', now()),
  ('viewer_invite', 1, 'You have been invited to view {{propertyName}}', '<p>{{inviterName}} invited you to view {{propertyName}} in Claritude.</p>', '{{inviterName}} invited you to view {{propertyName}} in Claritude.', array['inviterName','propertyName'], 'active', 'Property viewer invitation.', false, 'Claritude property membership workflow', now())
on conflict (template_key, version) do nothing;

insert into public.email_automations(key, template_key, enabled, essential, policy, trigger_key, delay_minutes, eligibility)
values
  ('welcome', 'welcome', false, false, '{"retrySafe":true}'::jsonb, 'account.created', 0, '{"requiresOutboundAutomation":true}'::jsonb),
  ('inactivity_60', 'inactivity_60', false, false, '{"retrySafe":true}'::jsonb, 'account.inactive_60', 0, '{"package":"free","daysInactive":60,"requiresOutboundAutomation":true}'::jsonb),
  ('inactivity_90', 'inactivity_90', false, false, '{"retrySafe":true}'::jsonb, 'account.inactive_90', 0, '{"package":"free","daysInactive":90,"requiresOutboundAutomation":true}'::jsonb),
  ('inactivity_freeze', 'inactivity_freeze', false, false, '{"retrySafe":true}'::jsonb, 'account.inactive_100', 0, '{"package":"free","daysInactive":100,"requiresOutboundAutomation":true,"deliveryRequiredBeforeFreeze":true}'::jsonb),
  ('deletion_eligible', 'deletion_eligible', false, false, '{"retrySafe":true}'::jsonb, 'account.inactive_121', 0, '{"package":"free","daysInactive":121,"automaticDeletion":false}'::jsonb),
  ('manual_freeze', 'manual_freeze', false, true, '{"retrySafe":true}'::jsonb, 'account.manually_frozen', 0, '{"requiresRecipient":true}'::jsonb),
  ('payment_receipt', 'payment_receipt', false, true, '{"retrySafe":true}'::jsonb, 'invoice.payment_succeeded', 0, '{"requiresVerifiedStripeEvent":true}'::jsonb),
  ('invoice_available', 'invoice_available', false, true, '{"retrySafe":true}'::jsonb, 'invoice.finalized', 0, '{"requiresVerifiedStripeEvent":true}'::jsonb),
  ('viewer_invite', 'viewer_invite', false, true, '{"retrySafe":true}'::jsonb, 'property.viewer_invited', 0, '{"requiresRecipient":true}'::jsonb)
on conflict (key) do update set
  template_key = excluded.template_key,
  trigger_key = excluded.trigger_key,
  eligibility = excluded.eligibility;
