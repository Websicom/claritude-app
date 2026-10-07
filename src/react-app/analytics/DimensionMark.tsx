import chromeLogo from "@browser-logos/chrome/chrome.svg";
import edgeLogo from "@browser-logos/edge/edge.svg";
import firefoxLogo from "@browser-logos/firefox/firefox.svg";
import internetExplorerLogo from "@browser-logos/internet-explorer_9-11/internet-explorer_9-11.svg";
import operaLogo from "@browser-logos/opera/opera.svg";
import safariLogo from "@browser-logos/safari/safari.svg";
import samsungInternetLogo from "@browser-logos/samsung-internet/samsung-internet.svg";
import "flag-icons/css/flag-icons.min.css";
import { Earth, Globe2, Monitor, Smartphone, Tablet } from "lucide-react";

const browserLogos: Record<string, string> = {
  chrome: chromeLogo,
  edge: edgeLogo,
  firefox: firefoxLogo,
  opera: operaLogo,
  safari: safariLogo,
  "samsung internet": samsungInternetLogo,
  "internet explorer": internetExplorerLogo,
};

export default function DimensionMark({ kind, value }: { kind: string; value: string }) {
  const normalized = String(value || "Unknown").toLocaleLowerCase();
  if (kind === "country") {
    const code = normalized === "uk" ? "gb" : normalized;
    return /^[a-z]{2}$/.test(code)
      ? <span className={`dimension-flag fi fi-${code}`} aria-hidden="true" />
      : <span className="dimension-mark neutral"><Earth /></span>;
  }
  if (kind === "browser")
    return browserLogos[normalized]
      ? <span className="dimension-mark browser"><img src={browserLogos[normalized]} alt="" /></span>
      : <span className="dimension-mark neutral"><Globe2 /></span>;
  if (kind === "device") {
    const Icon = normalized.includes("mobile") ? Smartphone : normalized.includes("tablet") ? Tablet : Monitor;
    return <span className="dimension-mark neutral"><Icon /></span>;
  }
  if (kind === "source") return <span className="dimension-mark neutral"><Globe2 /></span>;
  return <span className="dimension-mark neutral"><Earth /></span>;
}
