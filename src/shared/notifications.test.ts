import { describe, expect, it } from "vitest";
import { notificationCentreHref, notificationMatchesScope } from "./notifications";

describe("notification scope", () => {
  const propertyAlert = { account_id: "account-one", property_id: "property-one" };
  const accountAlert = { account_id: "account-one", property_id: null };

  it("routes property and workspace entry points to explicit scopes", () => {
    expect(notificationCentreHref("property-one", "account-one")).toBe("/notifications?property=property-one");
    expect(notificationCentreHref(undefined, "account-one")).toBe("/notifications?account=account-one");
    expect(notificationCentreHref()).toBe("/notifications");
  });

  it("matches property mode narrowly and workspace mode across the account", () => {
    expect(notificationMatchesScope(propertyAlert, "property-one", undefined)).toBe(true);
    expect(notificationMatchesScope(accountAlert, "property-one", undefined)).toBe(false);
    expect(notificationMatchesScope(propertyAlert, undefined, "account-one")).toBe(true);
    expect(notificationMatchesScope(accountAlert, undefined, "account-one")).toBe(true);
    expect(notificationMatchesScope(propertyAlert, undefined, "account-two")).toBe(false);
  });
});
