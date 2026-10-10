import { describe, expect, it } from "vitest";
import {
  approvedCatalogueAmount,
  approvedCatalogueStatus,
  financeMetrics,
} from "./index";

describe("Stage 3 approved billing catalogue", () => {
  it("accepts only the six exact GBP base prices", () => {
    expect(approvedCatalogueAmount("essentials", "gbp", "month", "base")).toBe(1500);
    expect(approvedCatalogueAmount("essentials", "gbp", "year", "base")).toBe(10800);
    expect(approvedCatalogueAmount("scale", "gbp", "month", "base")).toBe(4900);
    expect(approvedCatalogueAmount("scale", "gbp", "year", "base")).toBe(46800);
    expect(approvedCatalogueAmount("pro", "gbp", "month", "base")).toBe(12900);
    expect(approvedCatalogueAmount("pro", "gbp", "year", "base")).toBe(118800);
    expect(approvedCatalogueAmount("pro", "eur", "month", "base")).toBeNull();
    expect(approvedCatalogueAmount("pro", "gbp", "month", "additional_editing_seat")).toBeNull();
  });

  it("reports unsafe or incomplete mappings", () => {
    const rows = Object.entries({ essentials: [1500, 10800], scale: [4900, 46800], pro: [12900, 118800] }).flatMap(([packageKey, amounts]) =>
      (["month", "year"] as const).map((interval, index) => ({ package_versions: { package_key: packageKey }, currency: "gbp", interval, component: "base", unit_amount_minor: amounts[index], tax_behavior: "exclusive", provider_livemode: false, metadata: { productTaxCode: "txcd_10103001" } })),
    );
    expect(approvedCatalogueStatus(rows, "test")).toEqual(expect.objectContaining({ missing: [], issues: [] }));
    expect(approvedCatalogueStatus(rows.slice(1), "test").missing).toEqual(["essentials:gbp:month:base"]);
    expect(approvedCatalogueStatus([{ ...rows[0], tax_behavior: "unspecified" }, ...rows.slice(1)], "test").issues).toContainEqual({ key: "essentials:gbp:month:base", reason: "tax_behavior_must_be_exclusive" });
  });

  it("separates invoice revenue from tax collected", () => {
    expect(financeMetrics({
      subscriptions: [{ status: "active", currency: "gbp", interval: "month", unit_amount_minor: 1200, quantity: 2, mrr_minor: 2000 }],
      invoices: [{ currency: "gbp", total_minor: 2400, tax_minor: 400 }],
      payments: [{ currency: "gbp", status: "succeeded", amount_received_minor: 2400 }],
      refunds: [],
      disputes: [],
    })).toEqual([
      expect.objectContaining({ currency: "gbp", revenueExcludingTaxMinor: 2000, taxCollectedMinor: 400 }),
    ]);
  });
});
