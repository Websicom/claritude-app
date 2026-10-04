// Generated from Claritude-Audit-Catalogue-Stage3-Rationalisation.xlsx. Do not hand edit.
export type UserFacingAuditPresentationRole = "Scored check" | "Advisory / contextual" | "Contextual / policy-dependent" | "Advisory / optional" | "Advisory / conditional" | "Mixed: checks + diagnostics";
export type UserFacingAuditOutcomePolicy = "Passed / Failed / Not applicable / Unable to test" | "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant" | "Contextual: report policy/state; do not Fail without declared intent";
export type UserFacingAuditGroupDefinition = {
  id: string; name: string; category: string; subcategory: string; presentationRole: UserFacingAuditPresentationRole;
  outcomePolicy: UserFacingAuditOutcomePolicy; severity: string; weight: number; authoritativeReference: string | null;
  lifecycle: 'draft' | 'active' | 'disabled' | 'deprecated' | 'retired'; enabledByDefault: boolean; configurationVersion: number; sortOrder: number;
  technicalChecks: Array<{ checkId: string; action: string; sortOrder: number; lifecycle: 'draft' | 'active' | 'disabled' | 'deprecated' | 'retired'; enabledByDefault: boolean }>;
};
export const USER_FACING_AUDIT_GROUPS: UserFacingAuditGroupDefinition[] = [
  {
    "id": "audit-group.ai-and-crawler-readiness.ai-content-accessibility",
    "name": "AI content accessibility",
    "category": "AI & Crawler Readiness",
    "subcategory": "AI Content Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.openai.com/api/docs/bots",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 1,
    "technicalChecks": [
      {
        "checkId": "ai.content.source_extractable",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.main.content.extractable.after.javascript.rendering",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.login.requirement.encountered.by.the.audit.runner",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.bot.challenge.encountered.by.the.audit.runner",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.main.content.includes.machine.readable.text",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.ai-content-structure",
    "name": "AI content structure",
    "category": "AI & Crawler Readiness",
    "subcategory": "AI Content Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.openai.com/api/docs/bots",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 2,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.content.and.attribution.main.content.organised.under.semantic.headings",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.lists.available.in.machine.readable.html",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.tables.available.in.machine.readable.html",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.content-attribution-and-identity",
    "name": "Content attribution and identity",
    "category": "AI & Crawler Readiness",
    "subcategory": "Content & Attribution",
    "presentationRole": "Advisory / contextual",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://developers.openai.com/api/docs/bots",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 3,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.content.and.attribution.author.attribution.declared.in.structured.data",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.publisher.attribution.declared.in.structured.data",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.publication.date.declared.in.structured.data",
        "action": "Merge into advisory group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.modification.date.declared.in.structured.data",
        "action": "Merge into advisory group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.external.source.links.present.in.the.main.content",
        "action": "Merge into advisory group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.machine.readable.organisation.identity.present",
        "action": "Merge into advisory group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.machine.readable.author.identity.present",
        "action": "Merge into advisory group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.content.and.attribution.entity.sameas.references.use.valid.url.formats",
        "action": "Merge into advisory group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.ai-snippet-restrictions",
    "name": "AI snippet restrictions",
    "category": "AI & Crawler Readiness",
    "subcategory": "Crawler Permissions",
    "presentationRole": "Contextual / policy-dependent",
    "outcomePolicy": "Contextual: report policy/state; do not Fail without declared intent",
    "severity": "Advisory / contextual",
    "weight": 0,
    "authoritativeReference": "https://developers.openai.com/api/docs/bots",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 4,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.crawler.permissions.nosnippet.restrictions.detected",
        "action": "Merge into contextual group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.max.snippet.restrictions.detected",
        "action": "Merge into contextual group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.data.nosnippet.sections.detected",
        "action": "Merge into contextual group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.markdown-alternatives",
    "name": "Markdown alternatives",
    "category": "AI & Crawler Readiness",
    "subcategory": "Optional AI Resources",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://llmstxt.org/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 5,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.optional.resources.linked.markdown.alternative.for.the.selected.page.detected",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.declared.markdown.alternative.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.declared.markdown.alternative.contains.readable.content",
        "action": "Merge into advisory group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.llms-full-txt",
    "name": "llms-full.txt",
    "category": "AI & Crawler Readiness",
    "subcategory": "Optional AI Resources",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://llmstxt.org/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 6,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.optional.resources.llms.full.txt.file.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.full.txt.returned.as.readable.text",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.ai-and-crawler-readiness.llms-txt",
    "name": "llms.txt",
    "category": "AI & Crawler Readiness",
    "subcategory": "Optional AI Resources",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://llmstxt.org/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 7,
    "technicalChecks": [
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.file.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.returned.as.readable.text",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.title.detected",
        "action": "Merge into advisory group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.summary.detected",
        "action": "Merge into advisory group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.markdown.links.parse.correctly",
        "action": "Merge into advisory group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.llms.txt.links.checked.within.the.request.limit",
        "action": "Merge into advisory group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.optional.resources.selected.page.referenced.in.checked.llms.txt.links",
        "action": "Merge into advisory group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.aria-validity",
    "name": "ARIA validity",
    "category": "Accessibility",
    "subcategory": "ARIA",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/ARIA/apg/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 8,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.required.aria.attributes.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.aria.attribute.names.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.aria.attribute.values.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.aria.roles.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.aria.attributes.permitted.for.their.roles",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.required.aria.parent.roles.present",
        "action": "Merge into user-facing group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.required.aria.child.roles.present",
        "action": "Merge into user-facing group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.aria.references.point.to.existing.elements",
        "action": "Merge into user-facing group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.duplicate.ids.used.by.accessibility.references.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.button-accessible-names",
    "name": "Button accessible names",
    "category": "Accessibility",
    "subcategory": "Forms & Controls",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 9,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.buttons.have.accessible.names",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.image.buttons.have.accessible.names",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.form-control-labels",
    "name": "Form control labels",
    "category": "Accessibility",
    "subcategory": "Forms & Controls",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/tutorials/forms/labels/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 10,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.form.inputs.have.accessible.labels",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.select.controls.have.accessible.labels",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.textareas.have.accessible.labels",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.form.labels.reference.existing.controls",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.multiple.labels.for.the.same.control.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.navigation-control-names",
    "name": "Navigation control names",
    "category": "Accessibility",
    "subcategory": "Forms & Controls",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 11,
    "technicalChecks": [
      {
        "checkId": "accessibility.mobile.and.responsive.layout.primary.navigation.controls.have.accessible.names",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.alt-text-repeats-image-filenames",
    "name": "Alt text repeats image filenames",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 12,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.alt.text.repeats.image.filenames",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.autoplaying-media",
    "name": "Autoplaying media",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 13,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.autoplaying.media.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.iframe-titles",
    "name": "Iframe titles",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 14,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.iframes.have.accessible.titles",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.image-delivery",
    "name": "Image delivery",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 15,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.image.formats.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.image.transfer.sizes.measured",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.image-loading",
    "name": "Image loading",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Lazy_loading",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 16,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.below.the.fold.image.loading.attributes.inspected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.largest.contentful.paint.image.uses.lazy.loading",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.image-resources-fail-to-load",
    "name": "Image resources fail to load",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 17,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.image.resources.fail.to.load",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.image-sizing-and-dimensions",
    "name": "Image sizing and dimensions",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 18,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.image.intrinsic.dimensions.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.image.display.dimensions.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.oversized.images.relative.to.display.dimensions.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.image.width.and.height.attributes.present",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.image.aspect.ratio.distortion.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.images-contain-alt-attributes",
    "name": "Images contain alt attributes",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 19,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.images.contain.alt.attributes",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.images-marked-decorative-remain-focusable",
    "name": "Images marked decorative remain focusable",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 20,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.images.marked.decorative.remain.focusable",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.responsive-images",
    "name": "Responsive images",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 21,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.responsive.srcset.declarations.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.invalid.srcset.descriptors.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.svg-accessible-names",
    "name": "SVG accessible names",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 22,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.svg.elements.requiring.accessible.names.have.names",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.video-captions",
    "name": "Video captions",
    "category": "Accessibility",
    "subcategory": "Images & Media",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 23,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.videos.contain.caption.track.declarations",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.images.and.media.caption.track.resources.reachable",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.keyboard-and-focus",
    "name": "Keyboard and focus",
    "category": "Accessibility",
    "subcategory": "Keyboard & Focus",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 24,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.focusable.elements.inside.aria.hidden.content.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.nested.interactive.controls.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.positive.tabindex.values.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.scrollable.regions.keyboard.focusable",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.empty-alt-attributes",
    "name": "Empty alt attributes",
    "category": "Accessibility",
    "subcategory": "Page Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 25,
    "technicalChecks": [
      {
        "checkId": "accessibility.images.and.media.empty.alt.attributes.identified",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.meta-refresh",
    "name": "Meta refresh",
    "category": "Accessibility",
    "subcategory": "Page Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 26,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.meta.refresh.redirects.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.heading-visibility",
    "name": "Heading visibility",
    "category": "Accessibility",
    "subcategory": "Responsive Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/tutorials/page-structure/headings/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 27,
    "technicalChecks": [
      {
        "checkId": "accessibility.mobile.and.responsive.layout.main.heading.visible.at.tested.widths",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.mobile-text-sizing",
    "name": "Mobile text sizing",
    "category": "Accessibility",
    "subcategory": "Responsive Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 28,
    "technicalChecks": [
      {
        "checkId": "accessibility.mobile.and.responsive.layout.text.sizes.measured.at.tested.mobile.widths",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.responsive-content-consistency",
    "name": "Responsive content consistency",
    "category": "Accessibility",
    "subcategory": "Responsive Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 29,
    "technicalChecks": [
      {
        "checkId": "accessibility.mobile.and.responsive.layout.desktop.and.mobile.content.differences.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.responsive-layout-overflow",
    "name": "Responsive layout overflow",
    "category": "Accessibility",
    "subcategory": "Responsive Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 30,
    "technicalChecks": [
      {
        "checkId": "accessibility.mobile.and.responsive.layout.horizontal.page.overflow.detected.at.tested.widths",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.images.exceed.their.containing.elements",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.tables.overflow.their.containing.elements",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.fixed.elements.geometrically.overlap.main.content.at.tested.widths",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.viewport-configuration",
    "name": "Viewport configuration",
    "category": "Accessibility",
    "subcategory": "Responsive Accessibility",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 31,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.viewport.settings.restrict.zoom",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.viewport",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.multiple.viewport.declarations.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.viewport.width.configured.for.device.width",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.mobile.and.responsive.layout.elements.extend.beyond.tested.viewports",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.accessible-lists",
    "name": "Accessible lists",
    "category": "Accessibility",
    "subcategory": "Tables & Lists",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/quickref/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 32,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.definition.lists.have.valid.structure",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.lists.contain.valid.list.items",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.accessible-tables",
    "name": "Accessible tables",
    "category": "Accessibility",
    "subcategory": "Tables & Lists",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/tutorials/tables/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 33,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.table.headers.associated.with.data.cells",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.accessibility.table.header.cells.contain.text",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.colour-contrast",
    "name": "Colour contrast",
    "category": "Accessibility",
    "subcategory": "Visual & Interaction",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 34,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.text.contrast.measured.where.calculable",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.accessibility.touch-targets",
    "name": "Touch targets",
    "category": "Accessibility",
    "subcategory": "Visual & Interaction",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 35,
    "technicalChecks": [
      {
        "checkId": "accessibility.accessibility.touch.target.size.and.spacing.checked",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.cumulative-layout-shift",
    "name": "Cumulative Layout Shift",
    "category": "Performance",
    "subcategory": "Core Web Vitals & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/cls",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 36,
    "technicalChecks": [
      {
        "checkId": "performance.performance.cumulative.layout.shift.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.first-contentful-paint",
    "name": "First Contentful Paint",
    "category": "Performance",
    "subcategory": "Core Web Vitals & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/fcp",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 37,
    "technicalChecks": [
      {
        "checkId": "performance.performance.first.contentful.paint.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.largest-contentful-paint",
    "name": "Largest Contentful Paint",
    "category": "Performance",
    "subcategory": "Core Web Vitals & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/lcp",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 38,
    "technicalChecks": [
      {
        "checkId": "performance.performance.largest.contentful.paint.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.total-blocking-time",
    "name": "Total Blocking Time",
    "category": "Performance",
    "subcategory": "Core Web Vitals & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/tbt",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 39,
    "technicalChecks": [
      {
        "checkId": "performance.performance.total.blocking.time.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.font-loading",
    "name": "Font loading",
    "category": "Performance",
    "subcategory": "Delivery & Caching",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 40,
    "technicalChecks": [
      {
        "checkId": "performance.performance.font.display.declarations.inspected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.resource-preloads",
    "name": "Resource preloads",
    "category": "Performance",
    "subcategory": "Delivery & Caching",
    "presentationRole": "Advisory / conditional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 41,
    "technicalChecks": [
      {
        "checkId": "performance.performance.resource.preload.declarations.inspected",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "performance.performance.preloaded.resources.unused.during.the.test.detected",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.static-resource-caching",
    "name": "Static resource caching",
    "category": "Performance",
    "subcategory": "Delivery & Caching",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 42,
    "technicalChecks": [
      {
        "checkId": "performance.performance.static.resource.cache.directives.inspected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.text-compression",
    "name": "Text compression",
    "category": "Performance",
    "subcategory": "Delivery & Caching",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/uses-text-compression",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 43,
    "technicalChecks": [
      {
        "checkId": "performance.performance.text.compression.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.long-main-thread-tasks",
    "name": "Long main-thread tasks",
    "category": "Performance",
    "subcategory": "Execution & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 44,
    "technicalChecks": [
      {
        "checkId": "performance.performance.long.main.thread.tasks.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.render-blocking-resources",
    "name": "Render-blocking resources",
    "category": "Performance",
    "subcategory": "Execution & Rendering",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 45,
    "technicalChecks": [
      {
        "checkId": "performance.performance.render.blocking.resources.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.css-transfer-size",
    "name": "CSS transfer size",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 46,
    "technicalChecks": [
      {
        "checkId": "performance.performance.css.transfer.size.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.font-transfer-size",
    "name": "Font transfer size",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 47,
    "technicalChecks": [
      {
        "checkId": "performance.performance.font.transfer.size.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.image-transfer-size",
    "name": "Image transfer size",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 48,
    "technicalChecks": [
      {
        "checkId": "performance.performance.image.transfer.size.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.javascript-runtime-errors",
    "name": "JavaScript runtime errors",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 49,
    "technicalChecks": [
      {
        "checkId": "performance.performance.browser.console.errors.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "performance.performance.uncaught.javascript.exceptions.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.javascript-transfer-size",
    "name": "JavaScript transfer size",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 50,
    "technicalChecks": [
      {
        "checkId": "performance.performance.javascript.transfer.size.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.page-transfer-size",
    "name": "Page transfer size",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 51,
    "technicalChecks": [
      {
        "checkId": "performance.performance.total.transferred.page.size.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.resource-request-count",
    "name": "Resource request count",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 52,
    "technicalChecks": [
      {
        "checkId": "performance.performance.total.resource.request.count.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.third-party-requests",
    "name": "Third-party requests",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 53,
    "technicalChecks": [
      {
        "checkId": "performance.performance.third.party.request.count.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.unused-css",
    "name": "Unused CSS",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 54,
    "technicalChecks": [
      {
        "checkId": "performance.performance.unused.css.estimated",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.unused-javascript",
    "name": "Unused JavaScript",
    "category": "Performance",
    "subcategory": "Page Weight & Requests",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 55,
    "technicalChecks": [
      {
        "checkId": "performance.performance.unused.javascript.estimated",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.server-response-time",
    "name": "Server response time",
    "category": "Performance",
    "subcategory": "Performance Metrics",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/articles/ttfb",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 56,
    "technicalChecks": [
      {
        "checkId": "performance.performance.document.response.time.measured",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.failed-network-requests",
    "name": "Failed network requests",
    "category": "Performance",
    "subcategory": "Reliability",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 57,
    "technicalChecks": [
      {
        "checkId": "performance.performance.failed.network.requests.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.repeated-resource-downloads",
    "name": "Repeated resource downloads",
    "category": "Performance",
    "subcategory": "Reliability",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 58,
    "technicalChecks": [
      {
        "checkId": "performance.performance.repeated.downloads.of.the.same.resource.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.lcp-resource-optimisation",
    "name": "LCP resource optimisation",
    "category": "Performance",
    "subcategory": "Rendering Diagnostics",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 59,
    "technicalChecks": [
      {
        "checkId": "performance.performance.largest.contentful.paint.element.identified",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "performance.performance.largest.contentful.paint.resource.discovery.delay.measured",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.performance.layout-shift-contributors",
    "name": "Layout shift contributors",
    "category": "Performance",
    "subcategory": "Rendering Diagnostics",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://web.dev/performance/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 60,
    "technicalChecks": [
      {
        "checkId": "performance.performance.layout.shift.contributors.identified",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.h1-headings",
    "name": "H1 headings",
    "category": "SEO",
    "subcategory": "Content & Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/tutorials/page-structure/headings/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 61,
    "technicalChecks": [
      {
        "checkId": "seo.content.h1.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.empty.h1.headings.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.h1.multiple",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.heading-structure",
    "name": "Heading structure",
    "category": "SEO",
    "subcategory": "Content & Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/tutorials/page-structure/headings/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 62,
    "technicalChecks": [
      {
        "checkId": "seo.content.structure.and.headings.empty.h2.to.h6.headings.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.skipped.heading.levels.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.repeated.heading.text.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.main-content-availability",
    "name": "Main content availability",
    "category": "SEO",
    "subcategory": "Content & Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 63,
    "technicalChecks": [
      {
        "checkId": "seo.content.structure.and.headings.main.content.contains.extractable.text",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.main.content.word.count.measured",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.text.present.in.original.html",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.content.added.only.after.javascript.rendering.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.original.html.and.rendered.text.differences.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.main-content-landmark",
    "name": "Main content landmark",
    "category": "SEO",
    "subcategory": "Content & Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 64,
    "technicalChecks": [
      {
        "checkId": "seo.content.structure.and.headings.main.content.landmark.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.multiple.main.content.landmarks.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.semantic-content-structures",
    "name": "Semantic content structures",
    "category": "SEO",
    "subcategory": "Content & Structure",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 65,
    "technicalChecks": [
      {
        "checkId": "seo.content.structure.and.headings.lists.use.semantic.list.elements",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.content.structure.and.headings.data.tables.contain.header.cells",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.crawler-permissions",
    "name": "Crawler permissions",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Contextual / policy-dependent",
    "outcomePolicy": "Contextual: report policy/state; do not Fail without declared intent",
    "severity": "Advisory / contextual",
    "weight": 0,
    "authoritativeReference": "https://developers.openai.com/api/docs/bots",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 66,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.and.indexing.selected.page.allowed.by.googlebot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.selected.page.allowed.by.bingbot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.selected.page.allowed.by.oai.searchbot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.selected.page.allowed.by.gptbot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.selected.page.allowed.by.claude.searchbot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.selected.page.allowed.by.claudebot.robots.rules",
        "action": "Merge into contextual group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.explicit.chatgpt.user.robots.rules.detected",
        "action": "Merge into contextual group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.explicit.claude.user.robots.rules.detected",
        "action": "Merge into contextual group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.ai.search.and.training.crawler.permissions.differ",
        "action": "Merge into contextual group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.ai.crawler.rules.inherited.from.wildcard.directives.identified",
        "action": "Merge into contextual group",
        "sortOrder": 10,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "ai_readiness.crawler.permissions.googlebot.robots.access.for.the.selected.page.checked",
        "action": "Merge into contextual group",
        "sortOrder": 11,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.indexing-directives",
    "name": "Indexing directives",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 67,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.and.indexing.meta.robots.directives.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.x.robots.tag.directives.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.conflicting.indexing.directives.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.noindex.directive.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.nofollow.directive.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.page-redirects",
    "name": "Page redirects",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 68,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.and.indexing.redirect.chain.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.redirect.loop.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.containing.redirect.loops.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.redirecting-links",
    "name": "Redirecting links",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 69,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.redirecting.internal.links.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.redirecting.external.links.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.robots-txt",
    "name": "Robots.txt",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/crawling-indexing/robots/intro",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 70,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.and.indexing.robots.txt.file.reachable",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.robots.txt.contains.readable.text",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.robots.txt.parsing.errors.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.sitemap.url.declared.in.robots.txt",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.xml-sitemap",
    "name": "XML sitemap",
    "category": "SEO",
    "subcategory": "Crawling & Indexing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 71,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.and.indexing.conventional.sitemap.locations.checked",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.referenced.xml.sitemap.reachable",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.referenced.sitemap.xml.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.selected.page.found.in.checked.sitemap.files",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.and.indexing.sitemap.lastmod.date.formats.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.contact-link-formats",
    "name": "Contact link formats",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 72,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.telephone.link.formats.checked",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.email.link.formats.checked",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.download-links",
    "name": "Download links",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 73,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.download.links.identified",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.https-page-links-to-http-destinations",
    "name": "HTTPS page links to HTTP destinations",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 74,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.https.page.links.to.http.destinations",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.javascript-link-destinations",
    "name": "JavaScript link destinations",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 75,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.javascript.link.destinations.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.link-destination-health",
    "name": "Link destination health",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 76,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.checked.links.returning.http.404.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.returning.http.410.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.returning.server.errors.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.failing.dns.resolution.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.failing.https.connections.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.timing.out.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.blocked.by.access.restrictions.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.encountering.rate.limits.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.exceeding.the.redirect.limit.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.links.redirecting.to.broken.destinations.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 10,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.link-inventory",
    "name": "Link inventory",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 77,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.internal.links.identified",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.external.links.identified",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.checked.and.unchecked.link.totals.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.link-relationship-attributes",
    "name": "Link relationship attributes",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 78,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.sponsored.link.attributes.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.user.generated.content.link.attributes.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.link-text-and-accessible-names",
    "name": "Link text and accessible names",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 79,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.links.have.accessible.names",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.links.and.navigation.empty.anchor.text.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.links-have-non-empty-destinations",
    "name": "Links have non-empty destinations",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 80,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.links.have.non.empty.destinations",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.navigation-landmarks-have-distinguishable-accessible-names",
    "name": "Navigation landmarks have distinguishable accessible names",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 81,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.navigation.landmarks.have.distinguishable.accessible.names",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.on-page-fragment-links-point-to-existing-elements",
    "name": "On-page fragment links point to existing elements",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 82,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.on.page.fragment.links.point.to.existing.elements",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.placeholder-link-destinations",
    "name": "Placeholder link destinations",
    "category": "SEO",
    "subcategory": "Links & Navigation",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 83,
    "technicalChecks": [
      {
        "checkId": "seo.links.and.navigation.placeholder.link.destinations.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.canonical-url",
    "name": "Canonical URL",
    "category": "SEO",
    "subcategory": "Page Metadata",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 84,
    "technicalChecks": [
      {
        "checkId": "seo.page.metadata.canonical.url.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.multiple.canonical.urls.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.canonical.url.format.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.canonical.target.reachable",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.canonical.target.redirects",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.canonical.target.contains.a.noindex.directive",
        "action": "Merge into user-facing group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.canonical.points.to.a.different.page",
        "action": "Merge into user-facing group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.html-language",
    "name": "HTML language",
    "category": "SEO",
    "subcategory": "Page Metadata",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 85,
    "technicalChecks": [
      {
        "checkId": "seo.page.metadata.html.language.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.html.language.code.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.meta-description",
    "name": "Meta description",
    "category": "SEO",
    "subcategory": "Page Metadata",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/snippet",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 86,
    "technicalChecks": [
      {
        "checkId": "seo.metadata.description.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.metadata.description.not_empty",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.multiple.meta.descriptions.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.meta.description.length.measured",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.page-response",
    "name": "Page response",
    "category": "SEO",
    "subcategory": "Page Metadata",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Critical",
    "weight": 3,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 87,
    "technicalChecks": [
      {
        "checkId": "seo.crawling.http_status",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.crawling.html_content",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.page-title",
    "name": "Page title",
    "category": "SEO",
    "subcategory": "Page Metadata",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/title-link",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 88,
    "technicalChecks": [
      {
        "checkId": "seo.metadata.title.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.metadata.title.not_empty",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.page.metadata.multiple.page.titles.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.metadata.title.length",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "accessibility.document.title",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.apple-touch-icon",
    "name": "Apple touch icon",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 89,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.apple.touch.icon.declared",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.declared.apple.touch.icon.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.conflicting-duplicate-social-metadata",
    "name": "Conflicting duplicate social metadata",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 90,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.conflicting.duplicate.social.metadata.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.favicon",
    "name": "Favicon",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 91,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.favicon.declared",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.declared.favicon.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.open-graph-metadata",
    "name": "Open Graph metadata",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://ogp.me/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 92,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.title.present",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.description.present",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.url.present",
        "action": "Merge into advisory group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.type.present",
        "action": "Merge into advisory group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.image.declared",
        "action": "Merge into advisory group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.image.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.image.dimensions.measured",
        "action": "Merge into advisory group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.open.graph.url.agrees.with.the.canonical.url",
        "action": "Merge into advisory group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.x.twitter.title.or.open.graph.fallback.available",
        "action": "Merge into advisory group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.x.twitter.description.or.open.graph.fallback.available",
        "action": "Merge into advisory group",
        "sortOrder": 10,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.x.twitter.image.or.open.graph.fallback.available",
        "action": "Merge into advisory group",
        "sortOrder": 11,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.web-app-manifest",
    "name": "Web app manifest",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://developers.google.com/search/docs",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 93,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.web.app.manifest.linked",
        "action": "Merge into advisory group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.linked.web.app.manifest.reachable",
        "action": "Merge into advisory group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.social.sharing.and.site.identity.web.app.manifest.contains.valid.json",
        "action": "Merge into advisory group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.x-card-metadata",
    "name": "X Card metadata",
    "category": "SEO",
    "subcategory": "Social & Sharing",
    "presentationRole": "Advisory / optional",
    "outcomePolicy": "Advisory when absent/suboptimal; Pass only when positively verified; N/A where irrelevant",
    "severity": "Advisory",
    "weight": 0,
    "authoritativeReference": "https://developer.x.com/en/docs/x-for-websites/cards/overview/abouts-cards",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 94,
    "technicalChecks": [
      {
        "checkId": "seo.social.sharing.and.site.identity.x.twitter.card.type.declared",
        "action": "Keep as advisory",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.article-structured-data",
    "name": "Article structured data",
    "category": "SEO",
    "subcategory": "Structured Data",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 95,
    "technicalChecks": [
      {
        "checkId": "seo.structured.data.article.headline.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.article.author.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.article.publication.date.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.article.modification.date.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.breadcrumb-structured-data",
    "name": "Breadcrumb structured data",
    "category": "SEO",
    "subcategory": "Structured Data",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 96,
    "technicalChecks": [
      {
        "checkId": "seo.structured.data.breadcrumb.items.have.names.and.positions",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.breadcrumb.positions.form.a.consistent.sequence",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.organisation-structured-data",
    "name": "Organisation structured data",
    "category": "SEO",
    "subcategory": "Structured Data",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 97,
    "technicalChecks": [
      {
        "checkId": "seo.structured.data.organisation.name.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.organisation.website.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.product-structured-data",
    "name": "Product structured data",
    "category": "SEO",
    "subcategory": "Structured Data",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 98,
    "technicalChecks": [
      {
        "checkId": "seo.structured.data.declared.product.price.formats.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.declared.product.currency.codes.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.seo.structured-data-validity",
    "name": "Structured data validity",
    "category": "SEO",
    "subcategory": "Structured Data",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 99,
    "technicalChecks": [
      {
        "checkId": "seo.structured.data.json.ld.blocks.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.json.ld.syntax.valid",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.schema.org.types.identified",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.structured.data.context.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.structured.data.url.identifiers.use.valid.formats",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.structured.data.url.properties.use.valid.formats",
        "action": "Merge into user-facing group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.local.entity.references.resolve.within.the.document",
        "action": "Merge into user-facing group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.duplicate.entity.identifiers.contain.conflicting.values",
        "action": "Merge into user-facing group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.structured.data.dates.use.valid.formats",
        "action": "Merge into user-facing group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.checked.structured.data.image.urls.reachable",
        "action": "Merge into user-facing group",
        "sortOrder": 10,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "seo.structured.data.structured.data.page.url.matches.the.selected.url",
        "action": "Merge into user-facing group",
        "sortOrder": 11,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.content-security-policy",
    "name": "Content Security Policy",
    "category": "Security",
    "subcategory": "Content Security Policy",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 100,
    "technicalChecks": [
      {
        "checkId": "security.headers.csp",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.content.security.policy.is.report.only",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.content.security.policy.contains.unsafe.inline.allowances",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.content.security.policy.contains.unsafe.eval.allowances",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.browser.reported.security.policy.violations.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.cookie-security",
    "name": "Cookie security",
    "category": "Security",
    "subcategory": "Cookie Security",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 101,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.observed.cookies.have.secure.attributes",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.observed.cookies.have.httponly.attributes",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.observed.cookies.have.samesite.attributes",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.response.cookie.attributes.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.secure-forms-and-credentials",
    "name": "Secure forms and credentials",
    "category": "Security",
    "subcategory": "Forms & Credentials",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 102,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.insecure.form.submission.destinations.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.password.fields.appear.on.an.http.page",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.https-availability",
    "name": "HTTPS availability",
    "category": "Security",
    "subcategory": "HTTPS & Transport",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Critical",
    "weight": 3,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 103,
    "technicalChecks": [
      {
        "checkId": "security.https.selected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.http.version.redirects.to.https",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.https.connection.succeeds",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.mixed-content",
    "name": "Mixed content",
    "category": "Security",
    "subcategory": "HTTPS & Transport",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 104,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.active.mixed.content.requests.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.http.image.and.media.references.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.frame-embedding-protection",
    "name": "Frame embedding protection",
    "category": "Security",
    "subcategory": "Security Headers",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 105,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.frame.embedding.protection.declared",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.http-strict-transport-security",
    "name": "HTTP Strict Transport Security",
    "category": "Security",
    "subcategory": "Security Headers",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 106,
    "technicalChecks": [
      {
        "checkId": "security.headers.hsts",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.strict.transport.security.directives.parse.correctly",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.mime-sniffing-protection",
    "name": "MIME sniffing protection",
    "category": "Security",
    "subcategory": "Security Headers",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 107,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.x.content.type.options.header.present",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.x.content.type.options.set.to.nosniff",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.permissions-policy",
    "name": "Permissions Policy",
    "category": "Security",
    "subcategory": "Security Headers",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 108,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.permissions.policy.header.present",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.security.referrer-policy",
    "name": "Referrer Policy",
    "category": "Security",
    "subcategory": "Security Headers",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Security",
    "weight": 2,
    "authoritativeReference": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 109,
    "technicalChecks": [
      {
        "checkId": "security.security.and.browser.protections.referrer.policy.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "security.security.and.browser.protections.referrer.policy.value.recognised",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.apex-and-www-redirect-behaviour",
    "name": "Apex and www redirect behaviour",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 110,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.apex.and.www.http.redirect.behaviour.compared",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.caa-configuration",
    "name": "CAA configuration",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.rfc-editor.org/rfc/rfc8659",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 111,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.caa.certificate.authority.restrictions.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.dmarc-configuration",
    "name": "DMARC configuration",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.rfc-editor.org/rfc/rfc7489",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 112,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.dmarc.record.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.dmarc.policy.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.dns-configuration",
    "name": "DNS configuration",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Mixed: checks + diagnostics",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.cloudflare.com/learning/dns/what-is-dns/",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 113,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.selected.hostname.resolves.successfully",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.ipv4.addresses.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.ipv6.addresses.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.returned.cname.records.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.returned.dns.record.ttls.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 5,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.domain.nameservers.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 6,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.domain.soa.record.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 7,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.dns.resolver.errors.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 8,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.non.existent.hostname.response.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 9,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.dnssec.validation.status.reported.by.the.resolver",
        "action": "Merge into user-facing group",
        "sortOrder": 10,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.apex.domain.resolution.checked",
        "action": "Merge into user-facing group",
        "sortOrder": 11,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.www.hostname.resolution.checked",
        "action": "Merge into user-facing group",
        "sortOrder": 12,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.mail-exchange-records",
    "name": "Mail exchange records",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 114,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.mail.exchange.records.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.spf-configuration",
    "name": "SPF configuration",
    "category": "Technical",
    "subcategory": "DNS & Domain",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://www.rfc-editor.org/rfc/rfc7208",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 115,
    "technicalChecks": [
      {
        "checkId": "infrastructure.dns.and.domain.configuration.spf.record.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.dns.and.domain.configuration.multiple.spf.records.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.cdn-reverse-proxy",
    "name": "CDN / reverse proxy",
    "category": "Technical",
    "subcategory": "Server & HTTP",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 116,
    "technicalChecks": [
      {
        "checkId": "infrastructure.server.and.http.information.cdn.or.reverse.proxy.header.indicators.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.cache-status",
    "name": "Cache status",
    "category": "Technical",
    "subcategory": "Server & HTTP",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 117,
    "technicalChecks": [
      {
        "checkId": "infrastructure.server.and.http.information.cache.hit.or.miss.headers.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.response-format",
    "name": "Response format",
    "category": "Technical",
    "subcategory": "Server & HTTP",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 118,
    "technicalChecks": [
      {
        "checkId": "infrastructure.http.content_type",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.response.character.encoding.declared",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.server-timing",
    "name": "Server timing",
    "category": "Technical",
    "subcategory": "Server & HTTP",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 119,
    "technicalChecks": [
      {
        "checkId": "infrastructure.server.and.http.information.server.timing.metrics.detected",
        "action": "Keep as standalone",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.technology-disclosure",
    "name": "Technology disclosure",
    "category": "Technical",
    "subcategory": "Server & HTTP",
    "presentationRole": "Scored check",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 120,
    "technicalChecks": [
      {
        "checkId": "infrastructure.server.and.http.information.server.software.header.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.technology.disclosure.headers.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  },
  {
    "id": "audit-group.technical.http-caching-metadata",
    "name": "HTTP caching metadata",
    "category": "Technical",
    "subcategory": "Technical Diagnostics",
    "presentationRole": "Mixed: checks + diagnostics",
    "outcomePolicy": "Passed / Failed / Not applicable / Unable to test",
    "severity": "Warning",
    "weight": 1,
    "authoritativeReference": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching",
    "lifecycle": "active",
    "enabledByDefault": true,
    "configurationVersion": 1,
    "sortOrder": 121,
    "technicalChecks": [
      {
        "checkId": "infrastructure.server.and.http.information.cache.control.directives.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 1,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.etag.header.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 2,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.last.modified.header.detected",
        "action": "Merge into user-facing group",
        "sortOrder": 3,
        "lifecycle": "active",
        "enabledByDefault": true
      },
      {
        "checkId": "infrastructure.server.and.http.information.vary.header.recorded",
        "action": "Merge into user-facing group",
        "sortOrder": 4,
        "lifecycle": "active",
        "enabledByDefault": true
      }
    ]
  }
];
export const USER_FACING_GROUP_BY_TECHNICAL_CHECK = new Map(USER_FACING_AUDIT_GROUPS.flatMap((group) => group.technicalChecks.map((mapping) => [mapping.checkId, group.id] as const)));
