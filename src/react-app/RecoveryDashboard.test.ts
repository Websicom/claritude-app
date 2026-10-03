import { describe, expect, it } from "vitest";
import {
  filterProperties,
  filterWorkspaceMemberships,
  propertyFaviconSources,
} from "./RecoveryDashboard";

describe("top selector searches", () => {
  const workspaces = [
    { role: "owner", workspaces: { id: "one", name: "Websi Agency" } },
    { role: "member", workspaces: { id: "two", name: "Client Sandbox" } },
  ];
  const properties = [
    { id: "one", name: "EdgeTier", canonical_host: "edgetier.com" },
    { id: "two", name: "North Commerce", canonical_host: "shop.example" },
  ] as any[];

  it("filters workspaces case-insensitively and ignores surrounding whitespace", () => {
    expect(filterWorkspaceMemberships(workspaces, "  AGENCY ")).toEqual([
      workspaces[0],
    ]);
    expect(filterWorkspaceMemberships(workspaces, "   ")).toEqual(workspaces);
    expect(filterWorkspaceMemberships(workspaces, "missing")).toEqual([]);
  });

  it("searches property names and displayed domains", () => {
    expect(filterProperties(properties, " EDGE ")).toEqual([properties[0]]);
    expect(filterProperties(properties, "EXAMPLE")).toEqual([properties[1]]);
    expect(filterProperties(properties, "")).toEqual(properties);
  });

  it("loads property favicons directly with independent provider fallbacks", () => {
    expect(propertyFaviconSources("https://www.example.com/path")).toEqual([
      "https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fwww.example.com&sz=64",
      "https://icons.duckduckgo.com/ip3/www.example.com.ico",
      "https://www.example.com/favicon.ico",
    ]);
    expect(propertyFaviconSources("not a url")).toEqual([]);
  });
});
