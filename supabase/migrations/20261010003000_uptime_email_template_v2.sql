begin;

update public.email_templates
set state = 'retired'
where template_key in ('uptime_down', 'uptime_recovered')
  and state = 'active';

insert into public.email_templates (
  template_key, version, subject, html_body, text_body, variables, state,
  description, provider_managed, sending_path, published_at
)
values
(
  'uptime_down',
  2,
  '🔴 {{propertyName}} is down',
  $email$<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#171717;line-height:1.5"><div style="display:none;max-height:0;overflow:hidden">{{propertyName}} is unavailable. Claritude has opened an incident.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px">
  <tr><td style="padding:0 4px 18px"><a href="{{claritudeUrl}}" style="color:#171717;text-decoration:none;font-size:22px;font-weight:800;letter-spacing:-.5px">Claritude<span style="color:#00c989">.</span></a><span style="float:right;color:#737373;font-size:12px;padding-top:7px">Website monitoring</span></td></tr>
  <tr><td style="background:#fff;border:1px solid #e4e4e7;border-top:5px solid #e11d2e;border-radius:12px;padding:30px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="color:#e11d2e;font-size:28px;line-height:1;padding-right:12px;vertical-align:middle">&#9679;</td><td style="vertical-align:middle"><div style="color:#737373;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Incident open</div><h1 style="margin:2px 0 0;color:#171717;font-size:30px;line-height:1.2;letter-spacing:-.6px">{{propertyName}} is down</h1></td></tr></table>
    <p style="margin:22px 0 18px;color:#3f3f46;font-size:16px">Claritude opened an incident after the configured failure threshold. We’ll email you again as soon as a successful response confirms recovery.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e4e4e7">
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top;width:38%">Monitor</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere">{{propertyName}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Checked URL</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere">{{propertyUrl}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Root cause</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentCause}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Incident started</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentOpenedAt}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Monitoring interval</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{monitorInterval}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Alert threshold</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{failureThreshold}}</td></tr>
    </table>
    <div style="padding-top:24px"><a href="{{appUrl}}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;margin:0 8px 8px 0">View incident in Claritude</a><a href="{{propertyUrl}}" style="display:inline-block;background:#fff;color:#171717;text-decoration:none;font-size:14px;font-weight:700;padding:11px 18px;border:1px solid #d4d4d8;border-radius:8px;margin:0 0 8px">Open website</a></div>
  </td></tr>
  <tr><td style="height:16px"></td></tr>
  <tr><td style="background:#171717;border-radius:12px;padding:25px 28px"><h2 style="margin:0 0 8px;color:#fff;font-size:20px">{{monitoringNoteTitle}}</h2><p style="margin:0 0 14px;color:#d4d4d8;font-size:14px">{{monitoringNoteBody}}</p><a href="{{monitoringNoteUrl}}" style="color:#00c989;font-size:14px;font-weight:700;text-decoration:underline">{{monitoringNoteCta}} →</a></td></tr>
  <tr><td align="center" style="padding:22px 20px 4px;color:#737373;font-size:12px"><a href="{{claritudeUrl}}" style="color:#171717;font-weight:700;text-decoration:none">Claritude website</a><span style="padding:0 8px">·</span><a href="{{appUrl}}" style="color:#171717;font-weight:700;text-decoration:none">Uptime dashboard</a><p style="margin:8px 0 0">This alert was sent to a recipient configured in this property’s Uptime settings.</p></td></tr>
</table></td></tr></table></body></html>$email$,
  $text${{propertyName}} is down.

Claritude opened an incident after the configured failure threshold. We’ll email you again when a successful response confirms recovery.

Checked URL: {{propertyUrl}}
Root cause: {{incidentCause}}
Incident started: {{incidentOpenedAt}}
Monitoring interval: {{monitorInterval}}
Alert threshold: {{failureThreshold}}

View incident in Claritude: {{appUrl}}
Open website: {{propertyUrl}}

{{monitoringNoteTitle}}
{{monitoringNoteBody}}
{{monitoringNoteCta}}: {{monitoringNoteUrl}}

Claritude website: {{claritudeUrl}}$text$,
  array['propertyName','propertyUrl','incidentCause','incidentOpenedAt','monitorInterval','failureThreshold','appUrl','claritudeUrl','monitoringNoteTitle','monitoringNoteBody','monitoringNoteUrl','monitoringNoteCta'],
  'active',
  'Branded transactional downtime alert with incident details, dashboard and website links, and plan-aware monitoring guidance.',
  false,
  'Worker uptime notification queue',
  now()
),
(
  'uptime_recovered',
  2,
  '🟢 {{propertyName}} is back online',
  $email$<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f4f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#171717;line-height:1.5"><div style="display:none;max-height:0;overflow:hidden">{{propertyName}} has recovered and the incident is closed.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px">
  <tr><td style="padding:0 4px 18px"><a href="{{claritudeUrl}}" style="color:#171717;text-decoration:none;font-size:22px;font-weight:800;letter-spacing:-.5px">Claritude<span style="color:#00c989">.</span></a><span style="float:right;color:#737373;font-size:12px;padding-top:7px">Website monitoring</span></td></tr>
  <tr><td style="background:#fff;border:1px solid #e4e4e7;border-top:5px solid #00c989;border-radius:12px;padding:30px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="color:#00c989;font-size:28px;line-height:1;padding-right:12px;vertical-align:middle">&#9679;</td><td style="vertical-align:middle"><div style="color:#737373;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Incident resolved</div><h1 style="margin:2px 0 0;color:#171717;font-size:30px;line-height:1.2;letter-spacing:-.6px">{{propertyName}} is back online</h1></td></tr></table>
    <p style="margin:22px 0 18px;color:#3f3f46;font-size:16px">Claritude has confirmed a successful response and closed the incident.</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e4e4e7">
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top;width:38%">Monitor</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere">{{propertyName}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Checked URL</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top;overflow-wrap:anywhere">{{propertyUrl}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Root cause</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentCause}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Incident started</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentOpenedAt}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Recovered</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentResolvedAt}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Duration</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{incidentDuration}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Monitoring interval</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{monitorInterval}}</td></tr>
      <tr><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#737373;font-size:13px;vertical-align:top">Alert threshold</td><td style="padding:14px 0;border-bottom:1px solid #e4e4e7;color:#171717;font-size:14px;font-weight:600;vertical-align:top">{{failureThreshold}}</td></tr>
    </table>
    <div style="padding-top:24px"><a href="{{appUrl}}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;margin:0 8px 8px 0">View incident in Claritude</a><a href="{{propertyUrl}}" style="display:inline-block;background:#fff;color:#171717;text-decoration:none;font-size:14px;font-weight:700;padding:11px 18px;border:1px solid #d4d4d8;border-radius:8px;margin:0 0 8px">Open website</a></div>
  </td></tr>
  <tr><td style="height:16px"></td></tr>
  <tr><td style="background:#171717;border-radius:12px;padding:25px 28px"><h2 style="margin:0 0 8px;color:#fff;font-size:20px">{{monitoringNoteTitle}}</h2><p style="margin:0 0 14px;color:#d4d4d8;font-size:14px">{{monitoringNoteBody}}</p><a href="{{monitoringNoteUrl}}" style="color:#00c989;font-size:14px;font-weight:700;text-decoration:underline">{{monitoringNoteCta}} →</a></td></tr>
  <tr><td align="center" style="padding:22px 20px 4px;color:#737373;font-size:12px"><a href="{{claritudeUrl}}" style="color:#171717;font-weight:700;text-decoration:none">Claritude website</a><span style="padding:0 8px">·</span><a href="{{appUrl}}" style="color:#171717;font-weight:700;text-decoration:none">Uptime dashboard</a><p style="margin:8px 0 0">This alert was sent to a recipient configured in this property’s Uptime settings.</p></td></tr>
</table></td></tr></table></body></html>$email$,
  $text${{propertyName}} is back online.

Claritude confirmed a successful response and closed the incident.

Checked URL: {{propertyUrl}}
Root cause: {{incidentCause}}
Incident started: {{incidentOpenedAt}}
Recovered: {{incidentResolvedAt}}
Duration: {{incidentDuration}}
Monitoring interval: {{monitorInterval}}
Alert threshold: {{failureThreshold}}

View incident in Claritude: {{appUrl}}
Open website: {{propertyUrl}}

{{monitoringNoteTitle}}
{{monitoringNoteBody}}
{{monitoringNoteCta}}: {{monitoringNoteUrl}}

Claritude website: {{claritudeUrl}}$text$,
  array['propertyName','propertyUrl','incidentCause','incidentOpenedAt','incidentResolvedAt','incidentDuration','monitorInterval','failureThreshold','appUrl','claritudeUrl','monitoringNoteTitle','monitoringNoteBody','monitoringNoteUrl','monitoringNoteCta'],
  'active',
  'Branded transactional recovery alert with incident details, dashboard and website links, duration, and plan-aware monitoring guidance.',
  false,
  'Worker uptime notification queue',
  now()
)
on conflict (template_key, version) do update set
  subject = excluded.subject,
  html_body = excluded.html_body,
  text_body = excluded.text_body,
  variables = excluded.variables,
  state = excluded.state,
  description = excluded.description,
  provider_managed = excluded.provider_managed,
  sending_path = excluded.sending_path,
  published_at = excluded.published_at;

insert into private.app_migrations(version, name, checksum)
values ('20261010003000', 'uptime_email_template_v2', 'self')
on conflict (version) do nothing;

commit;
