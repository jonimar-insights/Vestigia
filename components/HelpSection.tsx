"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TranslationKey } from "@/lib/translations";

interface HelpSection {
  id: string;
  titleKey: TranslationKey;
  introKey: TranslationKey;
  items: TranslationKey[];
}

const SECTIONS: HelpSection[] = [
  {
    id: "start",
    titleKey: "help.start",
    introKey: "help.startIntro",
    items: ["help.start1", "help.start2", "help.start3", "help.start4"],
  },
  {
    id: "import",
    titleKey: "help.import",
    introKey: "help.importIntro",
    items: ["help.import1", "help.import2", "help.import3"],
  },
  {
    id: "folders",
    titleKey: "help.folders",
    introKey: "help.foldersIntro",
    items: ["help.folders1", "help.folders2", "help.folders3", "help.folders4"],
  },
  {
    id: "annotate",
    titleKey: "help.annotate",
    introKey: "help.annotateIntro",
    items: ["help.annotate1", "help.annotate2", "help.annotate3", "help.annotate4", "help.annotate6"],
  },
  {
    id: "shortcuts",
    titleKey: "help.shortcuts",
    introKey: "help.shortcutsIntro",
    items: [],
  },
  {
    id: "ai",
    titleKey: "help.ai",
    introKey: "help.aiIntro",
    items: ["help.ai1", "help.ai2", "help.ai3", "help.ai4", "help.ai5"],
  },
  {
    id: "search",
    titleKey: "help.search",
    introKey: "help.searchIntro",
    items: ["help.search1", "help.search2", "help.search3"],
  },
  {
    id: "cliplists",
    titleKey: "help.cliplists",
    introKey: "help.cliplistsIntro",
    items: ["help.cliplists1", "help.cliplists2", "help.cliplists3", "help.cliplists4"],
  },
  {
    id: "share",
    titleKey: "help.share",
    introKey: "help.shareIntro",
    items: ["help.share1", "help.share2", "help.share3", "help.share4", "help.share5"],
  },
  {
    id: "settings",
    titleKey: "help.settings",
    introKey: "help.settingsIntro",
    items: ["help.settings1", "help.settings2", "help.settings3"],
  },
  {
    id: "faq",
    titleKey: "help.faq",
    introKey: "help.faqIntro",
    items: ["help.faq1", "help.faq2", "help.faq3", "help.faq4"],
  },
];

const SHORTCUTS: Array<{ keys: string[]; labelKey: TranslationKey }> = [
  { keys: ["A"], labelKey: "help.shortcut.annotate" },
  { keys: ["Space"], labelKey: "help.shortcut.playPause" },
  { keys: ["\u2190", "\u2192"], labelKey: "help.shortcut.seek5" },
  { keys: ["Shift", "\u2190", "\u2192"], labelKey: "help.shortcut.prevNext" },
  { keys: ["Esc"], labelKey: "help.shortcut.escape" },
];

export default function HelpSection() {
  const { t } = useLanguage();
  const [openId, setOpenId] = useState<string>("start");

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">{t("help.title")}</h2>
        </div>
        <p className="text-xs text-muted/60 mt-1">{t("help.subtitle")}</p>
      </div>

      <div className="space-y-2">
        {SECTIONS.map((section) => {
          const open = openId === section.id;
          return (
            <div key={section.id} className="rounded-xl border border-border bg-surface overflow-hidden">
              <button
                onClick={() => setOpenId(open ? "" : section.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-hover/50 transition-colors"
                aria-expanded={open}
              >
                <span className="text-sm font-medium">{t(section.titleKey)}</span>
                <svg
                  className={`w-4 h-4 text-muted shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {open && (
                <div className="px-4 pb-4">
                  <p className="text-xs text-muted/70 leading-relaxed mb-3">{t(section.introKey)}</p>

                  {section.id === "shortcuts" ? (
                    <ul className="space-y-2">
                      {SHORTCUTS.map((s, i) => (
                        <li key={i} className="flex items-center justify-between gap-4">
                          <span className="text-xs text-foreground/80">{t(s.labelKey)}</span>
                          <span className="flex items-center gap-0.5 shrink-0">
                            {s.keys.map((k) => (
                              <kbd
                                key={k}
                                className="inline-block rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-mono text-muted"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ol className="space-y-2">
                      {section.items.map((itemKey) => (
                        <li key={itemKey} className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/50 shrink-0" />
                          <span className="text-xs text-foreground/80 leading-relaxed">{t(itemKey)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
