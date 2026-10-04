import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_REGISTRY } from "../src/shared/audit-registry.generated";
import { USER_FACING_AUDIT_GROUPS } from "../src/shared/audit-user-facing-registry.generated";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const technicalById = new Map(AUDIT_REGISTRY.map((check) => [check.id, check]));

const reasonByCategory: Record<string, string> = {
  "AI & Crawler Readiness": "Clear, machine-readable content and explicit crawler policy help compatible AI systems interpret the page without changing the publisher's intended access rules.",
  Accessibility: "This helps people using assistive technology, keyboards, touch screens, zoom, or smaller displays understand and operate the page.",
  Performance: "This affects how quickly and reliably visitors can see and interact with the page, especially on slower devices and connections.",
  SEO: "Clear page structure and dependable crawl signals help search engines understand the page and help visitors recognise useful results.",
  Security: "A correct implementation reduces avoidable browser and transport risk without claiming to replace a full security assessment.",
  Technical: "Reliable protocol, DNS, and response configuration helps browsers, crawlers, and connected services reach and interpret the site consistently.",
};

const recommendationRules: Array<[RegExp, string]> = [
  [/AI content accessibility/i, "Keep the main content available as readable HTML, avoid login or bot challenges on public pages, and make important text available after rendering."],
  [/AI content structure/i, "Organise the main content with semantic headings, lists, and tables where those structures match the content. Do not add markup solely for the audit."],
  [/Content attribution and identity/i, "Add accurate author, publisher, date, and identity data where it genuinely describes the page. Link entities with valid URLs and keep visible attribution consistent with structured data."],
  [/AI snippet restrictions/i, "Confirm that nosnippet, max-snippet, and data-nosnippet settings match the publisher's intended reuse policy. Remove a restriction only when broader snippets are genuinely wanted."],
  [/Markdown alternatives/i, "If a Markdown alternative is offered, declare it with a valid URL and ensure the resource returns readable Markdown. Do not add an alternative that will become stale or incomplete."],
  [/llms-full\.txt/i, "If you choose to publish llms-full.txt, return readable plain text or Markdown at the conventional root URL and keep it current. Its absence is optional and does not require remediation."],
  [/llms\.txt/i, "If you choose to publish llms.txt, use the proposed Markdown structure, include meaningful links, and keep every declared destination reachable. Its absence is optional and does not require remediation."],
  [/ARIA validity/i, "Correct the listed ARIA roles, attributes, values, parent-child relationships, and duplicate IDs. Prefer native HTML controls before adding ARIA."],
  [/Button accessible names/i, "Give each affected button a concise accessible name using visible text, aria-label, aria-labelledby, or meaningful image alt text."],
  [/Form control labels/i, "Associate every affected form control with one clear label using a label element, aria-label, or aria-labelledby. Keep the label meaningful and visible where possible."],
  [/Navigation control names/i, "Give the affected menu or navigation control a clear accessible name that describes its action, such as Open menu or Close menu."],
  [/Alt text repeats image filenames/i, "Replace filename-like alt text with a concise description of the image's purpose, or use an empty alt attribute when the image is purely decorative."],
  [/Autoplaying media/i, "Disable unexpected autoplay with sound, or provide an immediate pause or stop control. Preserve autoplay only when it is essential and does not obstruct access."],
  [/Iframe titles/i, "Add a short title attribute to each affected iframe so users can identify its purpose before entering it."],
  [/Image delivery|Image resources fail to load/i, "Correct each affected image URL and response. Confirm the file exists, returns an image content type, and is accessible without an authentication or bot challenge."],
  [/Image loading/i, "Lazy-load suitable below-the-fold images, but keep the hero or likely LCP image eager and discoverable. Use the occurrence viewport data to decide which images qualify."],
  [/Image sizing and dimensions/i, "Set accurate intrinsic width and height, preserve the source aspect ratio, and serve an image close to its rendered size. Update the listed images rather than applying one global dimension."],
  [/Images contain alt attributes|Empty alt attributes/i, "Write meaningful alt text for informative images and use alt=\"\" only for images that are genuinely decorative."],
  [/Images marked decorative remain focusable/i, "Remove focusability from decorative images, or provide a meaningful accessible name when the image is interactive."],
  [/Responsive images/i, "Use srcset and sizes when the same image is delivered at materially different display widths. Keep a valid src fallback."],
  [/SVG accessible names/i, "Give informative SVG images an accessible name, for example with title and aria-labelledby. Hide purely decorative SVGs from assistive technology."],
  [/Video captions/i, "Provide a synchronised captions track for videos containing speech or meaningful audio. Do not label machine-generated captions as final without checking them."],
  [/Keyboard and focus/i, "Remove focusable controls from aria-hidden regions, avoid nested interactive elements and positive tabindex values, and make scrollable regions keyboard reachable."],
  [/Meta refresh/i, "Replace timed meta refresh behaviour with a server redirect or an explicit user action. If a timed refresh is essential, warn users and allow enough time."],
  [/Heading visibility/i, "Ensure the main heading remains visible at the tested viewport and is not clipped, hidden, or replaced with an inaccessible visual treatment."],
  [/Mobile text sizing/i, "Increase the affected text to a readable mobile size while preserving zoom and responsive reflow. Check surrounding spacing after the change."],
  [/Responsive content consistency/i, "Keep essential content and controls available on both desktop and mobile. Responsive layouts may rearrange content, but should not remove necessary information."],
  [/Responsive layout overflow/i, "Fix the listed overflowing elements with responsive sizing, wrapping, or scroll containers. Avoid globally hiding horizontal overflow because that can conceal content."],
  [/Viewport configuration/i, "Use a single responsive viewport declaration with width=device-width and avoid disabling user zoom."],
  [/Accessible lists/i, "Use ul, ol, and li for real lists and keep list children structurally valid. Do not convert ordinary paragraphs into lists solely for styling."],
  [/Accessible tables/i, "Use table headers and explicit associations for data tables. Keep layout tables out of the accessibility tree where appropriate."],
  [/Colour contrast/i, "Adjust foreground or background colours for each listed element until text and controls meet the applicable WCAG contrast threshold."],
  [/Touch targets/i, "Increase the interactive area or spacing around each listed control. Preserve compact controls where an equivalent larger target is available."],
  [/Cumulative Layout Shift/i, "Reserve space for images, embeds, banners, and dynamic content. Use the listed shift contributors to fix the elements responsible for movement."],
  [/First Contentful Paint/i, "Reduce render-blocking work, improve server response time, and prioritise the first visible content. Confirm the change on both tested viewports."],
  [/Largest Contentful Paint/i, "Optimise the reported LCP element and its critical resource path. Prioritise the hero resource, reduce server delay, and avoid lazy-loading the LCP image."],
  [/Total Blocking Time|Long main-thread tasks/i, "Split long JavaScript tasks, defer non-critical work, and reduce expensive third-party execution. Start with the largest blocking tasks shown by the audit."],
  [/Font loading/i, "Use an appropriate font-display value, preload only critical fonts, and keep fallback metrics close to the final font to reduce invisible text and layout movement."],
  [/Resource preloads/i, "Keep preloads only for resources required very early in rendering, and remove unused or low-priority preloads that compete with critical downloads."],
  [/Static resource caching|HTTP caching metadata|Cache status/i, "Set cache directives and validators that match how often each resource changes. Do not apply long immutable caching to frequently changing HTML or personalised responses."],
  [/Text compression/i, "Enable Brotli, gzip, or another suitable content encoding for compressible text responses while avoiding recompression of already compressed formats."],
  [/Render-blocking resources/i, "Inline only small critical styles, defer non-critical scripts and styles, and preserve execution order where the page depends on it."],
  [/CSS transfer size|Unused CSS/i, "Remove unused rules, split styles by page or component, and minify production CSS without removing styles needed after interaction."],
  [/Font transfer size/i, "Subset fonts to required characters and weights, prefer modern formats, and avoid downloading unused font variants."],
  [/Image transfer size/i, "Resize and compress the listed images, choose an efficient format, and serve responsive variants without reducing necessary visual quality."],
  [/JavaScript runtime errors/i, "Fix the listed uncaught exceptions and console errors at their source. Re-test the user journey after correcting each failing script."],
  [/JavaScript transfer size|Unused JavaScript/i, "Remove unused dependencies and code, split bundles by route or feature, and defer non-critical scripts while preserving required functionality."],
  [/Page transfer size/i, "Reduce the largest avoidable resources first and verify that compression, image sizing, and code splitting improve the total without removing required content."],
  [/Resource request count/i, "Remove duplicate or unnecessary requests, combine only where caching and maintainability still benefit, and lazy-load resources that are not needed initially."],
  [/Third-party requests/i, "Remove unused third-party services and load necessary integrations only with appropriate consent and timing. Check the listed hosts before changing required business services."],
  [/Server response time/i, "Reduce application and database work, use suitable caching, and inspect hosting or upstream latency. Measure again from production after changes."],
  [/Failed network requests/i, "Correct or remove each failed request and confirm the destination returns the intended status, content type, and resource."],
  [/Repeated resource downloads/i, "Reuse a stable URL and cache policy for identical resources, and remove duplicate injections that cause the same asset to download more than once."],
  [/LCP resource optimisation/i, "Make the LCP resource discoverable in the initial HTML, give it suitable priority, and do not lazy-load it. Optimise only the resource identified by the evidence."],
  [/Layout shift contributors/i, "Reserve stable dimensions and avoid inserting content above existing content. Use the reported elements to isolate the actual shift source."],
  [/H1 headings/i, "Provide one clear primary heading where it accurately describes the page, and ensure every H1 contains readable text. Multiple H1s can be valid when the document structure genuinely requires them."],
  [/Heading structure/i, "Use headings to represent the content hierarchy, keep their text meaningful, and avoid skipping levels when that would make the structure confusing."],
  [/Main content availability/i, "Expose the primary page content as readable HTML after normal rendering and avoid gating public content behind unexpected login or bot challenges."],
  [/Main content landmark/i, "Wrap the page's primary content in one main element or equivalent landmark. Keep repeated navigation and footer content outside it."],
  [/Semantic content structures/i, "Use semantic lists and tables when the content calls for them. Keep the underlying HTML structure valid rather than relying on visual styling alone."],
  [/Crawler permissions/i, "Confirm each robots.txt and meta directive matches the site's intended crawler policy. Blocking a crawler is valid when deliberate; correct only contradictory, malformed, or unintended rules."],
  [/Indexing directives/i, "Remove unintended noindex or conflicting directives from pages meant for search, or document the deliberate exclusion for pages that should remain unindexed."],
  [/Page redirects/i, "Point the original URL directly to the final canonical destination, remove loops, and minimise unnecessary redirect hops."],
  [/Redirecting links/i, "Update affected internal links to their final destination. Keep deliberate external redirects only when the destination is trustworthy and stable."],
  [/Robots\.txt/i, "Serve a readable robots.txt at the site root, keep directives syntactically valid, and ensure listed sitemap URLs are correct."],
  [/XML sitemap/i, "Serve valid sitemap XML, use absolute canonical URLs, keep entries on the intended host, and remove broken or redirected sitemap references."],
  [/Contact link formats/i, "Correct affected mailto and tel destinations so they contain valid, usable addresses or telephone numbers."],
  [/Download links/i, "Confirm each download link intentionally identifies a downloadable resource and that the destination, filename, and format are clear to users."],
  [/HTTPS page links to HTTP destinations/i, "Update each listed HTTP destination to HTTPS where the destination supports it. Do not rewrite third-party URLs that have no valid HTTPS endpoint."],
  [/JavaScript link destinations/i, "Replace javascript: URLs with real links or buttons and attach behaviour with JavaScript event handlers."],
  [/Link destination health/i, "Correct, replace, or remove each affected destination according to its recorded DNS, TLS, timeout, redirect, or HTTP failure."],
  [/Link inventory/i, "Use the inventory to confirm important pages are linked and unnecessary destinations are removed. Counts alone do not require a change."],
  [/Link relationship attributes/i, "Add sponsored or ugc only where the relationship applies, and keep ordinary editorial links free of unnecessary relationship values."],
  [/Link text and accessible names/i, "Give each affected link concise text or an accessible name that identifies its destination or action out of context."],
  [/Links have non-empty destinations|Placeholder link destinations/i, "Replace empty and placeholder href values with a real destination, or use a button when the control performs an on-page action."],
  [/Navigation landmarks have distinguishable accessible names/i, "Give repeated navigation landmarks distinct accessible names, such as Primary, Footer, or Breadcrumb."],
  [/On-page fragment links point to existing elements/i, "Correct each fragment identifier so it matches a unique element ID on the page."],
  [/Canonical URL/i, "Declare one absolute canonical URL that represents the preferred page, resolves successfully, and does not point to a noindex or unintended destination."],
  [/HTML language/i, "Set a valid language code on the html element and use local lang attributes where content changes language."],
  [/Meta description/i, "Provide one useful description for pages intended for search. Keep it specific to the page and remove conflicting duplicate declarations."],
  [/Page response/i, "Return a successful HTML response for the selected page and correct the server, routing, or content-type configuration causing the recorded status."],
  [/Page title/i, "Provide one concise, descriptive title element and remove empty or conflicting duplicates. Keep the wording specific to the page."],
  [/Apple touch icon|Favicon/i, "Declare a reachable icon in a suitable format and size. This is an enhancement, so omit it rather than publishing a broken or misleading asset."],
  [/Conflicting duplicate social metadata/i, "Keep one consistent value for each social metadata property and remove duplicates that disagree."],
  [/Open Graph metadata/i, "Add accurate Open Graph values for pages that are likely to be shared, and ensure any declared image is reachable and representative. Absence remains advisory."],
  [/Web app manifest/i, "If the site is intended to behave as an installable web app, declare a valid reachable manifest. Otherwise no manifest is required."],
  [/X Card metadata/i, "Add X Card metadata only when tailored sharing previews are useful, and keep it consistent with visible page content and Open Graph data."],
  [/Article structured data/i, "Use Article structured data only for genuine article content and provide accurate headline, author, publisher, and date values."],
  [/Breadcrumb structured data/i, "Use BreadcrumbList only when the page has a real hierarchy, and keep item positions sequential with valid destination URLs."],
  [/Organisation structured data/i, "Declare the real organisation name and website URL on an appropriate page. Keep the structured identity consistent with visible information."],
  [/Product structured data/i, "Use Product data only for genuine products and provide valid numeric price and ISO currency values that match the visible offer."],
  [/Structured data validity/i, "Correct the listed JSON-LD syntax, URL, date, identifier, and reference errors. Keep schema types relevant to the page rather than adding unrelated markup."],
  [/Content Security Policy/i, "Deploy an enforced Content-Security-Policy, remove unnecessary unsafe-inline and unsafe-eval allowances, and test required third-party resources before tightening directives."],
  [/Cookie security/i, "Add Secure, HttpOnly, and an appropriate SameSite value to each sensitive cookie. Do not add HttpOnly to cookies that client-side code genuinely must read."],
  [/Secure forms and credentials/i, "Submit forms and credentials only to trusted HTTPS destinations and remove password fields from HTTP pages."],
  [/HTTPS availability/i, "Serve the site over HTTPS with a valid connection and redirect every HTTP origin directly to the intended HTTPS host."],
  [/Mixed content/i, "Replace each HTTP subresource with HTTPS or remove it. Confirm the replacement resource is trustworthy and functionally equivalent."],
  [/Frame embedding protection/i, "Use CSP frame-ancestors or X-Frame-Options to match the site's legitimate embedding requirements. Do not block framing that an authorised integration requires."],
  [/HTTP Strict Transport Security/i, "Send a valid Strict-Transport-Security header over HTTPS. Increase max-age and include subdomains only after confirming every covered host supports HTTPS."],
  [/MIME sniffing protection/i, "Send X-Content-Type-Options: nosniff and ensure every resource has the correct Content-Type."],
  [/Permissions Policy/i, "Declare a Permissions-Policy when browser feature access needs explicit control, and allow only the origins and features the site actually uses."],
  [/Referrer Policy/i, "Set a recognised Referrer-Policy that balances analytics needs with privacy and avoids sending sensitive URL data cross-origin."],
  [/Apex and www redirect behaviour/i, "Choose the preferred hostname and make both HTTP origins converge on it using short, permanent redirects without loops."],
  [/CAA configuration/i, "Publish CAA records only when certificate issuance should be restricted, and list every certificate authority the organisation legitimately uses."],
  [/DMARC configuration/i, "Publish one valid DMARC record at _dmarc and choose a policy that matches the organisation's monitoring and enforcement readiness."],
  [/DNS configuration/i, "Correct the specific resolver, apex, www, record, TTL, or wildcard behaviour shown in the sub-findings. Do not add record types the domain does not need."],
  [/Mail exchange records/i, "Publish valid MX records only when the domain receives email. If it intentionally does not receive mail, document that policy rather than inventing a mail server."],
  [/SPF configuration/i, "Publish one SPF TXT record that authorises the actual sending services and finishes with an appropriate all mechanism."],
  [/CDN \/ reverse proxy/i, "Treat the detected proxy information as context. Change the delivery architecture only when it causes a measured reliability, caching, or security problem."],
  [/Response format/i, "Return the correct media type and character encoding for the document. Use UTF-8 unless the application has a justified alternative."],
  [/Server timing/i, "Use Server-Timing only when useful operational metrics can be exposed safely. Absence alone does not justify adding internal implementation details."],
  [/Technology disclosure/i, "Remove unnecessary server and framework version headers while retaining headers required for correct operation and diagnostics."],
];

const exampleRules: Array<[RegExp, string]> = [
  [/ARIA validity/i, '<button aria-expanded="false" aria-controls="site-menu">Menu</button>'],
  [/Button accessible names|Navigation control names/i, '<button type="button" aria-label="Open navigation menu"><svg aria-hidden="true">…</svg></button>'],
  [/Form control labels/i, '<label for="email">Email address</label>\n<input id="email" name="email" type="email">'],
  [/Iframe titles/i, '<iframe src="/booking" title="Book an appointment"></iframe>'],
  [/Image sizing and dimensions/i, '<img src="/images/team.jpg" width="800" height="600" loading="lazy" alt="Our team">'],
  [/Images contain alt attributes|Empty alt attributes/i, '<img src="/images/founder.jpg" alt="Founder speaking at the annual conference">\n<img src="/images/divider.svg" alt="">'],
  [/Responsive images/i, '<img src="team-800.jpg" srcset="team-480.jpg 480w, team-800.jpg 800w" sizes="(max-width: 600px) 100vw, 800px" width="800" height="600" alt="Our team">'],
  [/SVG accessible names/i, '<svg role="img" aria-labelledby="chart-title">\n  <title id="chart-title">Quarterly sales chart</title>\n  …\n</svg>'],
  [/Video captions/i, '<video controls>\n  <source src="interview.mp4" type="video/mp4">\n  <track kind="captions" src="interview-en.vtt" srclang="en" label="English" default>\n</video>'],
  [/Viewport configuration/i, '<meta name="viewport" content="width=device-width, initial-scale=1">'],
  [/Accessible lists/i, '<ul>\n  <li>First service</li>\n  <li>Second service</li>\n</ul>'],
  [/Accessible tables/i, '<table>\n  <caption>Opening hours</caption>\n  <thead><tr><th scope="col">Day</th><th scope="col">Hours</th></tr></thead>\n  <tbody><tr><th scope="row">Monday</th><td>09:00–17:00</td></tr></tbody>\n</table>'],
  [/Colour contrast/i, '.button { color: #ffffff; background: #005a9c; }'],
  [/Font loading/i, '@font-face {\n  font-family: "Example Sans";\n  src: url("/fonts/example.woff2") format("woff2");\n  font-display: swap;\n}'],
  [/Text compression/i, 'Content-Encoding: br\nVary: Accept-Encoding'],
  [/H1 headings/i, '<main>\n  <h1>Website accessibility services</h1>\n  …\n</main>'],
  [/Main content landmark/i, '<header>…</header>\n<main id="main-content">…</main>\n<footer>…</footer>'],
  [/Robots\.txt/i, 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml'],
  [/XML sitemap/i, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc></url>\n</urlset>'],
  [/Contact link formats/i, '<a href="mailto:hello@example.com">Email us</a>\n<a href="tel:+442079460000">Call us</a>'],
  [/JavaScript link destinations/i, '<button type="button" id="open-dialog">Open details</button>'],
  [/Links have non-empty destinations|Placeholder link destinations/i, '<a href="/pricing">View pricing</a>'],
  [/Navigation landmarks have distinguishable accessible names/i, '<nav aria-label="Primary">…</nav>\n<nav aria-label="Footer">…</nav>'],
  [/On-page fragment links point to existing elements/i, '<a href="#pricing">View pricing</a>\n<section id="pricing">…</section>'],
  [/Canonical URL/i, '<link rel="canonical" href="https://example.com/preferred-page/">'],
  [/HTML language/i, '<html lang="en-GB">'],
  [/Meta description/i, '<meta name="description" content="Independent accessibility audits and practical remediation support.">'],
  [/Page title/i, '<title>Accessibility audits | Example Ltd</title>'],
  [/Apple touch icon/i, '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'],
  [/Favicon/i, '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'],
  [/Open Graph metadata/i, '<meta property="og:title" content="Accessibility audits">\n<meta property="og:description" content="Practical audits and remediation support.">\n<meta property="og:image" content="https://example.com/share.jpg">'],
  [/Web app manifest/i, '<link rel="manifest" href="/site.webmanifest">'],
  [/X Card metadata/i, '<meta name="twitter:card" content="summary_large_image">'],
  [/Article structured data/i, '<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"Article","headline":"Example article","author":{"@type":"Person","name":"Sam Lee"}}\n</script>'],
  [/Breadcrumb structured data/i, '{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://example.com/"}]}'],
  [/Organisation structured data/i, '{"@context":"https://schema.org","@type":"Organization","name":"Example Ltd","url":"https://example.com/"}'],
  [/Product structured data/i, '{"@context":"https://schema.org","@type":"Product","name":"Example product","offers":{"@type":"Offer","price":"29.00","priceCurrency":"GBP"}}'],
  [/Content Security Policy/i, "Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"],
  [/Cookie security/i, 'Set-Cookie: session=…; Path=/; Secure; HttpOnly; SameSite=Lax'],
  [/HTTPS availability/i, 'HTTP/1.1 301 Moved Permanently\nLocation: https://example.com/'],
  [/Frame embedding protection/i, "Content-Security-Policy: frame-ancestors 'self'"],
  [/HTTP Strict Transport Security/i, 'Strict-Transport-Security: max-age=31536000; includeSubDomains'],
  [/MIME sniffing protection/i, 'X-Content-Type-Options: nosniff'],
  [/Permissions Policy/i, 'Permissions-Policy: camera=(), microphone=(), geolocation=(self)'],
  [/Referrer Policy/i, 'Referrer-Policy: strict-origin-when-cross-origin'],
  [/DMARC configuration/i, 'Host: _dmarc.example.com\nType: TXT\nValue: v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com'],
  [/SPF configuration/i, 'Host: example.com\nType: TXT\nValue: v=spf1 include:_spf.example.net -all'],
  [/Response format/i, 'Content-Type: text/html; charset=utf-8'],
  [/HTTP caching metadata|Static resource caching/i, 'Cache-Control: public, max-age=31536000, immutable\nETag: "asset-v42"'],
  [/llms\.txt/i, '# Example Ltd\n> A short description of the site.\n\n## Important pages\n- [Services](https://example.com/services/)'],
  [/Markdown alternatives/i, '<link rel="alternate" type="text/markdown" href="/about.md">'],
];

function recommendationFor(name: string, category: string) {
  return recommendationRules.find(([pattern]) => pattern.test(name))?.[1]
    || (category === "Accessibility"
      ? `Correct the affected ${name.toLowerCase()} markup or interaction shown in the occurrences, then test it with keyboard and assistive technology.`
      : category === "Performance"
        ? `Use the measured values and affected resources to improve ${name.toLowerCase()}, then repeat the browser audit on mobile and desktop.`
        : category === "SEO"
          ? `Correct the affected ${name.toLowerCase()} declarations or destinations shown in the sub-findings, while keeping the page accurate for visitors.`
          : category === "Security"
            ? `Correct the affected ${name.toLowerCase()} response or browser policy and test legitimate site behaviour before enforcing the change.`
            : category === "Technical"
              ? `Correct the specific ${name.toLowerCase()} configuration shown in the evidence and verify the response from the public hostname.`
              : `Improve ${name.toLowerCase()} only where it matches the publisher's content and crawler policy, then validate every declared resource.`);
}

function labelFor(url: string, name: string) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "developers.google.com") return `Google Search Central: ${name}`;
  if (host.endsWith("w3.org")) return `W3C WAI: ${name}`;
  if (host === "web.dev") return `web.dev: ${name}`;
  if (host === "developer.mozilla.org") return `MDN: ${name}`;
  if (host.endsWith("owasp.org")) return `OWASP: ${name}`;
  if (host === "www.rfc-editor.org" || host === "rfc-editor.org") return `RFC Editor: ${name}`;
  if (host === "schema.org") return `Schema.org: ${name}`;
  if (host === "developers.openai.com" || host === "platform.openai.com") return `OpenAI: ${name}`;
  if (host === "docs.anthropic.com") return `Anthropic: ${name}`;
  if (host === "llmstxt.org") return `llms.txt proposal: ${name}`;
  if (host.endsWith("cloudflare.com")) return `Cloudflare Learning Center: ${name}`;
  return `${host}: ${name}`;
}

function metricPresentation(name: string) {
  if (/Cumulative Layout Shift/i.test(name)) return { kind: "metric", fields: ["mobileValue", "desktopValue", "threshold"], unit: "score", threshold: "0.1 or less" };
  if (/Largest Contentful Paint/i.test(name)) return { kind: "metric", fields: ["mobileValue", "desktopValue", "threshold"], unit: "seconds_from_ms", threshold: "2.5 seconds or less" };
  if (/First Contentful Paint/i.test(name)) return { kind: "metric", fields: ["mobileValue", "desktopValue", "threshold"], unit: "seconds_from_ms", threshold: "1.8 seconds or less" };
  if (/Total Blocking Time/i.test(name)) return { kind: "metric", fields: ["mobileValue", "desktopValue", "threshold"], unit: "milliseconds", threshold: "200 milliseconds or less" };
  return null;
}

function lowerTopic(value: string) {
  return /^(?:AI|ARIA|CAA|CDN|CLS|CSP|DMARC|DNS|DOM|FCP|H1|HTML|HTTP|HTTPS|IPv4|IPv6|JSON-LD|LCP|MIME|MX|SEO|SPF|SVG|TBT|URL|XML|X Card)(?:\b|\s|\/)/.test(value)
    ? value
    : value.charAt(0).toLowerCase() + value.slice(1);
}

function contentFor(group: (typeof USER_FACING_AUDIT_GROUPS)[number]) {
  const topic = lowerTopic(group.name);
  const titles = group.technicalChecks.map((mapping) => technicalById.get(mapping.checkId)?.title || mapping.checkId);
  const examples = titles.slice(0, 3).map(lowerTopic);
  const focus = `Claritude examines ${topic} using ${group.technicalChecks.length} technical ${group.technicalChecks.length === 1 ? "check" : "checks"}, including ${examples.join(", ")}${titles.length > examples.length ? ", and related evidence" : ""}. ${reasonByCategory[group.category]}`;
  const optional = group.outcomePolicy.startsWith("Advisory when");
  const contextual = group.outcomePolicy.startsWith("Contextual:");
  const metric = metricPresentation(group.name);
  const passedMessage = metric
    ? `Mobile was {mobileValue} and desktop was {desktopValue}. The recommended threshold is {threshold}.`
    : `All {checkedCount} applicable technical checks verified ${topic}.`;
  const failedMessage = `{failedCount} of {checkedCount} technical checks found a problem with ${topic}.`;
  const advisoryMessage = optional
    ? `The audit found an optional or suboptimal ${topic} opportunity. This is not a confirmed technical failure.`
    : contextual
      ? `The audit recorded the site's ${topic} policy. Confirm that this state matches the publisher's intent; it is not automatically a defect.`
      : `The evidence indicates an opportunity to improve ${topic}, but it does not justify treating it as a confirmed failure.`;
  const notApplicableMessage = `No relevant ${topic} target was present on this page, so the group did not apply.`;
  const unableToTestMessage = `Claritude could not reach a reliable conclusion about ${topic}. {unableReason}`;
  const exampleFix = exampleRules.find(([pattern]) => pattern.test(group.name))?.[1] || null;
  const occurrenceEnabled = !["DNS & Domain", "Server & HTTP", "Performance Metrics", "Core Web Vitals & Rendering"].includes(group.subcategory)
    || /Failed network requests|Layout shift contributors|LCP resource optimisation/i.test(group.name);
  return {
    id: group.id,
    focus,
    passedMessage,
    failedMessage,
    advisoryMessage,
    notApplicableMessage,
    unableToTestMessage,
    recommendation: recommendationFor(group.name, group.category),
    exampleFix,
    referenceUrl: group.authoritativeReference,
    referenceLabel: labelFor(group.authoritativeReference || "https://claritude.io/", group.name),
    evidencePresentation: metric || {
      kind: contextual ? "policy" : "summary",
      fields: ["checkedCount", "passedCount", "failedCount", "advisoryCount", "unableCount", "status", "url", "value"],
    },
    occurrencePresentation: {
      enabled: occurrenceEnabled,
      initialLimit: 10,
      fields: ["html", "locator", "url", "resourceType", "viewport", "status", "value", "source"],
    },
  };
}

const content = USER_FACING_AUDIT_GROUPS.map(contentFor);
const ts = `// Generated by scripts/generate-stage4-audit-content.ts. Do not hand edit.\n` +
`export type UserFacingAuditEvidencePresentation = { kind: \"summary\" | \"metric\" | \"policy\"; fields: string[]; unit?: \"score\" | \"seconds_from_ms\" | \"milliseconds\"; threshold?: string };\n` +
`export type UserFacingAuditOccurrencePresentation = { enabled: boolean; initialLimit: number; fields: string[] };\n` +
`export type UserFacingAuditContentDefinition = { id: string; focus: string; passedMessage: string; failedMessage: string; advisoryMessage: string; notApplicableMessage: string; unableToTestMessage: string; recommendation: string; exampleFix: string | null; referenceUrl: string | null; referenceLabel: string; evidencePresentation: UserFacingAuditEvidencePresentation; occurrencePresentation: UserFacingAuditOccurrencePresentation };\n` +
`export const USER_FACING_AUDIT_CONTENT: UserFacingAuditContentDefinition[] = ${JSON.stringify(content, null, 2)};\n` +
`export const USER_FACING_AUDIT_CONTENT_BY_ID = new Map(USER_FACING_AUDIT_CONTENT.map((item) => [item.id, item] as const));\n`;
fs.writeFileSync(path.join(root, "src", "shared", "audit-user-facing-content.generated.ts"), ts);

const sql = (value: unknown) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const seedValues = content.map((item) => `(${sql(item.id)},${sql(item.focus)},${sql(item.passedMessage)},${sql(item.failedMessage)},${sql(item.advisoryMessage)},${sql(item.notApplicableMessage)},${sql(item.unableToTestMessage)},${sql(item.recommendation)},${sql(item.exampleFix)},${sql(item.referenceLabel)},${sql(JSON.stringify(item.evidencePresentation))}::jsonb,${sql(JSON.stringify(item.occurrencePresentation))}::jsonb,2)`).join(",\n  ");
const seed = `-- Generated by scripts/generate-stage4-audit-content.ts. Do not hand edit.\nwith content (id,focus,passed_message,failed_message,advisory_message,not_applicable_message,unable_to_test_message,recommendation,example_fix,reference_label,evidence_presentation,occurrence_presentation,configuration_version) as (values\n  ${seedValues}\n)\nupdate public.audit_user_facing_groups as target set\n  focus=content.focus,\n  passed_message=content.passed_message,\n  failed_message=content.failed_message,\n  advisory_message=content.advisory_message,\n  not_applicable_message=content.not_applicable_message,\n  unable_to_test_message=content.unable_to_test_message,\n  recommendation=content.recommendation,\n  example_fix=content.example_fix,\n  reference_label=content.reference_label,\n  evidence_presentation=content.evidence_presentation,\n  occurrence_presentation=content.occurrence_presentation,\n  configuration_version=content.configuration_version,\n  changed_at=now()\nfrom content\nwhere target.id=content.id;\n\ndo $$\nbegin\n  if (select count(*) from public.audit_user_facing_groups where configuration_version = 2 and focus is not null) <> 121 then\n    raise exception 'Stage 4 content must match all 121 approved user-facing groups';\n  end if;\nend $$;\n`;
fs.writeFileSync(path.join(root, "supabase", "seed", "030_audit_user_facing_content.sql"), seed);
const migrationPath = process.env.STAGE4_MIGRATION_PATH;
if (migrationPath) {
  const version = path.basename(migrationPath).split("_")[0];
  const migration = `begin;

alter table public.audit_user_facing_groups
  add column focus text,
  add column passed_message text,
  add column failed_message text,
  add column advisory_message text,
  add column not_applicable_message text,
  add column unable_to_test_message text,
  add column recommendation text,
  add column example_fix text,
  add column reference_label text,
  add column evidence_presentation jsonb,
  add column occurrence_presentation jsonb;

${seed}
alter table public.audit_user_facing_groups
  alter column focus set not null,
  alter column passed_message set not null,
  alter column failed_message set not null,
  alter column advisory_message set not null,
  alter column not_applicable_message set not null,
  alter column unable_to_test_message set not null,
  alter column recommendation set not null,
  alter column reference_label set not null,
  alter column evidence_presentation set not null,
  alter column occurrence_presentation set not null;

alter table public.audit_user_facing_groups
  add constraint audit_user_facing_groups_evidence_presentation_object
    check (jsonb_typeof(evidence_presentation) = 'object'),
  add constraint audit_user_facing_groups_occurrence_presentation_object
    check (jsonb_typeof(occurrence_presentation) = 'object');

comment on column public.audit_user_facing_groups.focus is 'Stage 4 explanation of what the stable group checks and why it matters.';
comment on column public.audit_user_facing_groups.example_fix is 'Optional practical example; null where no universal safe example exists.';
comment on column public.audit_user_facing_groups.evidence_presentation is 'Typed allow-list for compact, check-specific evidence values.';
comment on column public.audit_user_facing_groups.occurrence_presentation is 'Typed occurrence visibility, initial limit, and safe field allow-list.';

insert into private.app_migrations(version, name, checksum)
values ('${version}', 'stage4_user_facing_audit_content', 'self')
on conflict (version) do nothing;

commit;
`;
  fs.writeFileSync(path.resolve(root, migrationPath), migration);
}
const contentMigrationPath = process.env.STAGE4_CONTENT_ONLY_MIGRATION_PATH;
if (contentMigrationPath) {
  const version = path.basename(contentMigrationPath).split("_")[0];
  fs.writeFileSync(path.resolve(root, contentMigrationPath), `begin;\n\n${seed}\ninsert into private.app_migrations(version, name, checksum)\nvalues ('${version}', 'stage4_user_facing_audit_copy_refinement', 'self')\non conflict (version) do nothing;\n\ncommit;\n`);
}
console.log(JSON.stringify({ groups: content.length, examples: content.filter((item) => item.exampleFix).length, references: content.filter((item) => item.referenceUrl).length }, null, 2));
