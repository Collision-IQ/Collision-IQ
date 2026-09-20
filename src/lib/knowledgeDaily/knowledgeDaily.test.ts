import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import KnowledgeDailyFeed from "@/components/knowledgeDaily/KnowledgeDailyFeed";
import { formatKnowledgeDailyDate, getKnowledgeDailyEntries, getKnowledgeDailyEntry } from "./entries";

// Licensed estimating guides are cited by section, never linked (CLAUDE.md
// link policy). A daily entry must never carry one of their addresses.
const LICENSED_GUIDE_HOSTS = ["mymitchell.com", "cccis.com", "vercel.com"];

describe("Knowledge Base Daily entries", () => {
  const entries = getKnowledgeDailyEntries();

  it("publishes at least the first week and numbers entries without gaps", () => {
    expect(entries.length).toBeGreaterThanOrEqual(4);
    const numbers = entries.map((entry) => entry.entryNumber).sort((a, b) => a - b);
    numbers.forEach((n, i) => expect(n).toBe(i + 1));
    expect(new Set(entries.map((entry) => entry.slug)).size).toBe(entries.length);
  });

  it("orders newest first with ISO dates", () => {
    for (const entry of entries) expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1].date >= entries[i].date).toBe(true);
    }
  });

  it("gives every entry a headline, figure, summary, both callouts, tags, and a card that exists", () => {
    for (const entry of entries) {
      expect(entry.headline.length).toBeGreaterThan(20);
      expect(entry.keyFigure.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.whyItMatters.length).toBeGreaterThan(20);
      expect(entry.howCollisionIqUsesIt.length).toBeGreaterThan(20);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(entry.image.alt.length).toBeGreaterThan(10);
      expect(existsSync(path.join(process.cwd(), "public", entry.image.src))).toBe(true);
    }
  });

  it("links every source over https and never to a licensed estimating guide", () => {
    for (const entry of entries) {
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const source of entry.sources) {
        const url = new URL(source.url);
        expect(url.protocol).toBe("https:");
        expect(LICENSED_GUIDE_HOSTS.some((host) => url.hostname.endsWith(host))).toBe(false);
        expect(source.label.length).toBeGreaterThan(5);
        expect(source.publisher.length).toBeGreaterThan(2);
      }
    }
  });

  it("looks entries up by slug and formats dates in UTC", () => {
    expect(getKnowledgeDailyEntry("ford-officially-mandates-adas-standards")?.entryNumber).toBe(2);
    expect(getKnowledgeDailyEntry("nope")).toBeNull();
    expect(formatKnowledgeDailyDate("2026-09-09")).toBe("Wednesday, Sep 9, 2026");
  });
});

describe("KnowledgeDailyFeed", () => {
  const html = renderToStaticMarkup(createElement(KnowledgeDailyFeed, { entries: getKnowledgeDailyEntries() }));

  it("opens every link in a new tab with rel noopener noreferrer", () => {
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    const sourceCount = getKnowledgeDailyEntries().reduce((n, entry) => n + entry.sources.length, 0);
    expect(anchors.length).toBeGreaterThanOrEqual(sourceCount);
    for (const anchor of anchors) {
      expect(anchor).toMatch(/target="_blank"/);
      expect(anchor).toMatch(/rel="noopener noreferrer"/);
    }
  });

  it("renders every entry with its number and card", () => {
    for (const entry of getKnowledgeDailyEntries()) {
      expect(html).toContain(`id="${entry.slug}"`);
      expect(html).toContain(`Entry #${entry.entryNumber}`);
      expect(html).toContain(`src="${entry.image.src}"`);
    }
  });

  it("shows the empty state when nothing is filed", () => {
    expect(renderToStaticMarkup(createElement(KnowledgeDailyFeed, { entries: [] }))).toContain("No entries have been filed yet");
  });
});
