export const ALERT_BANNER_SNOOZE_KEY = "claritude-alert-banner-snoozed-until";

export function notificationCentreHref(propertyId?: string, accountId?: string) {
  const params = new URLSearchParams();
  if (propertyId) params.set("property", propertyId);
  else if (accountId) params.set("account", accountId);
  return `/notifications${params.size ? `?${params}` : ""}`;
}

export function notificationMatchesScope(
  notification: { account_id?: string | null; property_id?: string | null },
  propertyId?: string,
  accountId?: string,
) {
  if (propertyId) return notification.property_id === propertyId;
  if (accountId) return notification.account_id === accountId;
  return true;
}
