'use client';

import { useMemo, useState } from 'react';
import { Mail, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  helpArticleSearchText,
  helpCategoriesFor,
  type HelpAudience,
  type HelpArticle,
} from '@/lib/help/articles';
import type { HelpPlanPricing } from '@/lib/help/pricing';
import { InlineBold } from './InlineBold';
import { HelpPricingTable } from './HelpPricingTable';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@theraptly.com';

interface HelpCenterContentProps {
  audience: HelpAudience;
  /** Live plan prices for the pricing answer; omitted when unavailable. */
  planPricing?: HelpPlanPricing[];
}

function HelpArticleBody({
  article,
  planPricing,
}: {
  article: HelpArticle;
  planPricing?: HelpPlanPricing[];
}) {
  return (
    <div className="flex flex-col gap-3 text-sm text-text-secondary">
      {article.intro && (
        <p>
          <InlineBold text={article.intro} />
        </p>
      )}
      {article.steps && (
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          {article.steps.map((step) => (
            <li key={step}>
              <InlineBold text={step} />
            </li>
          ))}
        </ol>
      )}
      {article.pricingTable && <HelpPricingTable pricing={planPricing} />}
      {article.outro && (
        <p>
          <InlineBold text={article.outro} />
        </p>
      )}
    </div>
  );
}

export default function HelpCenterContent({ audience, planPricing }: HelpCenterContentProps) {
  const [query, setQuery] = useState('');

  const categories = useMemo(() => helpCategoriesFor(audience), [audience]);

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;

    return categories
      .map((category) => ({
        ...category,
        articles: category.articles.filter((article) =>
          helpArticleSearchText(article).toLowerCase().includes(q),
        ),
      }))
      .filter((category) => category.articles.length > 0);
  }, [categories, query]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Help Center</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Find answers to common questions, or get in touch with our support team if you need a
          hand.
        </p>
      </header>

      <div className="mb-8">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help articles…"
          aria-label="Search help articles"
          startIcon={<Search className="size-4" />}
        />
      </div>

      <section className="mb-10 rounded-xl border border-border bg-background-secondary p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="size-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Contact Support</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Can&apos;t find what you&apos;re looking for? Email us and we&apos;ll get back to you.
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
            >
              <Mail className="size-4" />
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </section>

      {filteredCategories.length === 0 ? (
        <div className="rounded-xl border border-border bg-background">
          <EmptyTableState
            message="No results found"
            subMessage={`We couldn't find anything matching "${query.trim()}". Try a different search, or email our support team above.`}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          {filteredCategories.map((category) => (
            <section key={category.slug}>
              <h2 className="mb-4 text-base font-semibold text-foreground">{category.title}</h2>
              <Accordion type="single" collapsible className="flex flex-col gap-3">
                {category.articles.map((article) => (
                  <AccordionItem key={article.slug} value={article.slug}>
                    <AccordionTrigger>{article.question}</AccordionTrigger>
                    <AccordionContent>
                      <HelpArticleBody article={article} planPricing={planPricing} />
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
