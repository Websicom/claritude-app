export type AiPlatformId = "chatgpt" | "claude" | "gemini" | "perplexity" | "copilot" | "grok";

export type AiPlatform = {
  id: AiPlatformId;
  name: string;
  icon: string;
  attributionDomains: string[];
  allowSubdomains: boolean;
  campaignAliases: string[];
  destination: string;
  promptMode: "query" | "copy";
};

export const AI_PLATFORMS: readonly AiPlatform[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    icon: "/assets/source-icons/chatgpt.svg",
    attributionDomains: ["chatgpt.com", "chat.openai.com"],
    allowSubdomains: true,
    campaignAliases: ["chatgpt"],
    destination: "https://chatgpt.com/",
    promptMode: "query",
  },
  {
    id: "claude",
    name: "Claude",
    icon: "/assets/source-icons/claude.svg",
    attributionDomains: ["claude.ai"],
    allowSubdomains: true,
    campaignAliases: ["claude"],
    destination: "https://claude.ai/new",
    promptMode: "query",
  },
  {
    id: "gemini",
    name: "Gemini",
    icon: "/assets/source-icons/gemini.svg",
    attributionDomains: ["gemini.google.com"],
    allowSubdomains: false,
    campaignAliases: ["gemini", "google-gemini"],
    destination: "https://gemini.google.com/app",
    promptMode: "query",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    icon: "/assets/source-icons/perplexity.svg",
    attributionDomains: ["perplexity.ai"],
    allowSubdomains: true,
    campaignAliases: ["perplexity"],
    destination: "https://www.perplexity.ai/search",
    promptMode: "query",
  },
  {
    id: "copilot",
    name: "Copilot",
    icon: "/assets/source-icons/copilot.svg",
    attributionDomains: ["copilot.microsoft.com", "copilot.cloud.microsoft", "copilot.com"],
    allowSubdomains: true,
    campaignAliases: ["copilot", "microsoft-copilot"],
    destination: "https://copilot.com/",
    promptMode: "copy",
  },
  {
    id: "grok",
    name: "Grok",
    icon: "/assets/source-icons/grok.svg",
    attributionDomains: ["grok.com"],
    allowSubdomains: true,
    campaignAliases: ["grok", "xai-grok"],
    destination: "https://grok.com/",
    promptMode: "query",
  },
] as const;

export const AI_PLATFORM_BY_ID = new Map(AI_PLATFORMS.map((platform) => [platform.id, platform]));

function attributionHost(value: unknown) {
  const raw = String(value || "").trim().toLocaleLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesDomain(host: string, domain: string, allowSubdomains: boolean) {
  return host === domain || (allowSubdomains && host.endsWith(`.${domain}`));
}

function platformFromHost(value: unknown) {
  const host = attributionHost(value);
  if (!host) return null;
  return AI_PLATFORMS.find((platform) =>
    platform.attributionDomains.some((domain) => matchesDomain(host, domain, platform.allowSubdomains)),
  ) || null;
}

function platformFromCampaign(value: unknown) {
  const campaign = String(value || "").trim().toLocaleLowerCase();
  if (!campaign) return null;
  return AI_PLATFORMS.find((platform) =>
    platform.campaignAliases.includes(campaign) || platform.attributionDomains.includes(campaign.replace(/^www\./, "")),
  ) || null;
}

export function identifyAiPlatform(input: {
  campaign?: unknown;
  referrer?: unknown;
  source?: unknown;
}) {
  // Explicit campaign attribution wins. Referrer attribution comes next, then
  // the tracker's acquisition source. Returning once prevents double counting.
  return platformFromCampaign(input.campaign)
    || platformFromHost(input.referrer)
    || platformFromHost(input.source)
    || platformFromCampaign(input.source);
}

export function aiPlatformPromptUrl(platform: AiPlatform, phrase: string) {
  if (platform.promptMode !== "query") return platform.destination;
  const url = new URL(platform.destination);
  url.searchParams.set("q", phrase);
  return url.toString();
}
