import type { Lang } from "@assets/catalog";
import termsEn from "@assets/legal/en/terms.md?raw";
import privacyEn from "@assets/legal/en/privacy.md?raw";
import termsRu from "@assets/legal/ru/terms.md?raw";
import privacyRu from "@assets/legal/ru/privacy.md?raw";

const SUPPORT_BOT = "esimkerteambot";
const DEFAULT_BOT = (
  (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || "esimker_bot"
)
  .trim()
  .replace(/^@/, "");

const DOCS: Record<Lang, Record<"terms" | "privacy", string>> = {
  en: { terms: termsEn, privacy: privacyEn },
  ru: { terms: termsRu, privacy: privacyRu },
};

function siteDomain(): string {
  if (typeof window !== "undefined" && window.location.hostname) {
    return window.location.hostname;
  }
  return "esimker.com";
}

function fillPlaceholders(text: string): string {
  const domain = siteDomain();
  const bot = `@${DEFAULT_BOT}`;
  const support = `@${SUPPORT_BOT}`;
  const email = `support@${domain}`;

  return text
    .replace(/`\[insert domain\]`/g, domain)
    .replace(/\[insert domain\]/gi, domain)
    .replace(/`\[insert @username\]`/g, bot)
    .replace(/\[insert @username\]/gi, bot)
    .replace(/`\[insert email\]`/g, email)
    .replace(/\[insert email\]/gi, email)
    .replace(/\[указать домен[^\]]*\]/g, domain)
    .replace(/\[указать @username бота\]/g, bot)
    .replace(/\[указать @username поддержки\]/g, support)
    .replace(/\[указать @username\]/g, bot)
    .replace(/\[указать e-mail\]/g, email);
}

export function getLegalDoc(lang: Lang, kind: "terms" | "privacy"): string {
  return fillPlaceholders(DOCS[lang][kind]);
}

function inlineMd(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "$1");
}

export function renderLegalMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line === "---") {
      closeList();
      out.push('<hr style="border:none;border-top:1px solid var(--line);margin:14px 0" />');
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      out.push(
        `<h1 style="font-size:var(--fs-lg);font-weight:700;margin:0 0 10px;line-height:1.3">${inlineMd(line.slice(2))}</h1>`,
      );
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      out.push(
        `<h2 style="font-size:var(--fs-md);font-weight:700;margin:16px 0 8px;line-height:1.35">${inlineMd(line.slice(3))}</h2>`,
      );
      continue;
    }

    if (line.startsWith("> ")) {
      closeList();
      out.push(
        `<blockquote style="margin:10px 0;padding:10px 12px;border-left:3px solid var(--line-strong);color:var(--text-dim)">${inlineMd(line.slice(2))}</blockquote>`,
      );
      continue;
    }

    if (/^[-*] /.test(line) || /^\d+\.\s/.test(line)) {
      if (!inList) {
        out.push('<ul style="margin:6px 0 10px;padding-left:18px">');
        inList = true;
      }
      const item = line.replace(/^[-*] /, "").replace(/^\d+\.\s/, "");
      out.push(`<li style="margin:4px 0">${inlineMd(item)}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      out.push('<div style="height:8px"></div>');
      continue;
    }

    closeList();
    out.push(`<p style="margin:0 0 8px">${inlineMd(line)}</p>`);
  }

  closeList();
  return out.join("");
}
