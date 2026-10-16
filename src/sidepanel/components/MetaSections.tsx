/**
 * Meta report sections: title vs H1, description, keywords, canonical, robots.
 * These all live in <head>, so none of them highlight anything on the page and
 * none of them get a layer toggle.
 */
import { META_DESCRIPTION_MAX, META_DESCRIPTION_MIN } from "../../shared/config";
import type { MetaScan } from "../../shared/types";
import { Badge, Field, Tag } from "./ui";

export function countTitleIssues(meta: MetaScan): number {
  return meta.titleVsH1.matches === false ? 1 : 0;
}

export function countDescriptionIssues(meta: MetaScan): number {
  const { status, duplicated } = meta.description;
  return (status === "ok" ? 0 : 1) + (duplicated ? 1 : 0);
}

export function countKeywordsIssues(meta: MetaScan): number {
  const { values, duplicated } = meta.keywords;
  return (values.length === 0 || values[0] === "" ? 1 : 0) + (duplicated ? 1 : 0);
}

export function countCanonicalIssues(meta: MetaScan): number {
  const { matchesCurrent, duplicated } = meta.canonical;
  return (matchesCurrent === false ? 1 : 0) + (duplicated ? 1 : 0) + (meta.robots.noindex ? 1 : 0);
}

const DESCRIPTION_TONE = {
  ok: "ok",
  short: "warn",
  long: "warn",
  empty: "error",
  missing: "error",
} as const;

const DESCRIPTION_LABEL = {
  ok: "in range",
  short: "too short",
  long: "too long",
  empty: "empty tag",
  missing: "missing",
} as const;

export function TitleVsH1({ meta }: { meta: MetaScan }) {
  const { title, h1Texts, matches, note } = meta.titleVsH1;

  return (
    <div className="px-2 py-1.5">
      <Field label="Title">
        {title === null ? (
          <span className="text-red-600 dark:text-red-400">No title found</span>
        ) : (
          <span>{title}</span>
        )}
      </Field>
      <Field label="H1">
        {h1Texts.length === 0 ? (
          <span className="text-red-600 dark:text-red-400">No H1 found</span>
        ) : (
          <span>
            {h1Texts[0]}
            {h1Texts.length > 1 && (
              <span className="ml-1 text-neutral-500">(+{h1Texts.length - 1} more)</span>
            )}
          </span>
        )}
      </Field>
      <Field label="Result">
        {matches === null ? (
          <Badge tone="muted">Not compared</Badge>
        ) : matches ? (
          <Badge tone="ok">Match</Badge>
        ) : (
          <Badge tone="error">Does not match</Badge>
        )}
        {note && <span className="ml-1.5 text-[10px] text-neutral-500">{note}</span>}
      </Field>
    </div>
  );
}

export function MetaDescription({ meta }: { meta: MetaScan }) {
  const { values, charCount, status, duplicated } = meta.description;

  return (
    <div className="px-2 py-1.5">
      <Field label="Content">
        {values.length === 0 ? (
          <span className="text-red-600 dark:text-red-400">No description found</span>
        ) : (
          <span>{values[0] || <em className="text-red-600 dark:text-red-400">(empty)</em>}</span>
        )}
      </Field>
      <Field label="Length">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono">{charCount} characters</span>
          <Badge tone={DESCRIPTION_TONE[status]}>{DESCRIPTION_LABEL[status]}</Badge>
          <span className="text-[10px] text-neutral-500">
            target {META_DESCRIPTION_MIN}-{META_DESCRIPTION_MAX}
          </span>
        </span>
      </Field>
      {duplicated && (
        <div className="pt-1">
          <Tag tone="error">{values.length} description tags</Tag>{" "}
          <span className="text-[10px] text-neutral-500">only the first one is used</span>
        </div>
      )}
    </div>
  );
}

export function MetaKeywords({ meta }: { meta: MetaScan }) {
  const { values, duplicated } = meta.keywords;
  const hasKeywords = values.length > 0 && values[0] !== "";

  return (
    <div className="px-2 py-1.5">
      <Field label="Content">
        {hasKeywords ? (
          <span>{values[0]}</span>
        ) : (
          // The plan requires this exact wording when the tag is absent/empty.
          <span className="text-neutral-500 dark:text-neutral-400">No keyword found</span>
        )}
      </Field>
      {duplicated && (
        <div className="pt-1">
          <Tag tone="warn">{values.length} keywords tags</Tag>{" "}
          <span className="text-[10px] text-neutral-500">only the first one is used</span>
        </div>
      )}
    </div>
  );
}

export function CanonicalAndRobots({ meta, pageUrl }: { meta: MetaScan; pageUrl: string }) {
  const { canonical, robots } = meta;

  return (
    <div className="px-2 py-1.5">
      <Field label="Canonical">
        {canonical.resolved === null ? (
          <span className="text-red-600 dark:text-red-400">No canonical tag found</span>
        ) : (
          <span className="font-mono break-all">{canonical.resolved}</span>
        )}
      </Field>
      {canonical.matchesCurrent !== null && (
        <Field label="vs page">
          <span className="flex flex-wrap items-center gap-1.5">
            {canonical.matchesCurrent ? (
              <Badge tone="ok">Matches page URL</Badge>
            ) : (
              <Badge tone="error">Points elsewhere</Badge>
            )}
            {!canonical.matchesCurrent && (
              <span className="font-mono break-all text-[10px] text-neutral-500">{pageUrl}</span>
            )}
          </span>
        </Field>
      )}
      {canonical.duplicated && (
        <div className="pt-1">
          <Tag tone="warn">Multiple canonical tags</Tag>
        </div>
      )}

      <Field label="Robots">
        {robots.content === null ? (
          <span className="text-neutral-500 dark:text-neutral-400">No robots meta tag</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono">{robots.content}</span>
            {robots.noindex && <Tag tone="error">noindex</Tag>}
            {robots.nofollow && <Tag tone="error">nofollow</Tag>}
          </span>
        )}
      </Field>
    </div>
  );
}
