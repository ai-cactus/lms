import { Fragment } from 'react';

/**
 * Renders help-article copy with `**bold**` markers promoted to <strong>.
 * Deliberately not a markdown parser — the content module only uses this one
 * marker, so a split is cheaper and safer than a dependency.
 */
export function InlineBold({ text }: { text: string }) {
  const segments = text.split('**');

  return (
    <>
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-foreground">
            {segment}
          </strong>
        ) : (
          <Fragment key={index}>{segment}</Fragment>
        ),
      )}
    </>
  );
}
