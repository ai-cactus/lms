/**
 * Regression tests for TC-064 — the Help Center was static (no search). A
 * client-side search now filters the article list by question + body text and
 * shows an empty state for a query matching nothing.
 *
 * Assertions read the real content module rather than literal copy so product
 * wording can change without breaking the suite.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';

import HelpCenterContent from './HelpCenterContent';
import { BILLING_PLANS } from '@/lib/billing-plans';
import {
  HELP_CATEGORIES,
  helpArticleSearchText,
  helpCategoriesFor,
  type HelpArticle,
  type HelpAudience,
} from '@/lib/help/articles';

const articlesFor = (audience: HelpAudience): HelpArticle[] =>
  helpCategoriesFor(audience).flatMap((category) => category.articles);

const allArticles = articlesFor('all');

const bySlug = (slug: string): HelpArticle => {
  const article = allArticles.find((candidate) => candidate.slug === slug);
  if (!article) throw new Error(`No help article with slug "${slug}"`);
  return article;
};

/**
 * A word that matches exactly one article within `pool`, so a search for it can
 * be asserted precisely without hardcoding product copy. `bodyOnly` restricts
 * the pick to words absent from the article's own question, which proves the
 * search reaches the answer body.
 */
const uniqueSearchTerm = (
  article: HelpArticle,
  pool: HelpArticle[],
  { bodyOnly = false }: { bodyOnly?: boolean } = {},
): string => {
  const words =
    helpArticleSearchText(article)
      .toLowerCase()
      .match(/[a-z]{5,}/g) ?? [];
  const term = words.find((word) => {
    if (bodyOnly && article.question.toLowerCase().includes(word)) return false;
    return (
      pool.filter((candidate) => helpArticleSearchText(candidate).toLowerCase().includes(word))
        .length === 1
    );
  });
  if (!term) throw new Error(`No unique search term for "${article.slug}"`);
  return term;
};

const searchBox = () => screen.getByPlaceholderText(/search help articles/i);

describe('HelpCenterContent — audience filtering', () => {
  it('renders every admin-visible article and no worker-only article', () => {
    render(<HelpCenterContent audience="admin" />);

    for (const article of articlesFor('admin')) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }

    const workerOnly = allArticles.filter((article) => article.audience === 'worker');
    expect(workerOnly.length).toBeGreaterThan(0);
    for (const article of workerOnly) {
      expect(screen.queryByText(article.question)).not.toBeInTheDocument();
    }
  });

  it('renders every worker-visible article and no admin-only article', () => {
    render(<HelpCenterContent audience="worker" />);

    for (const article of articlesFor('worker')) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }

    const adminOnly = allArticles.filter((article) => article.audience === 'admin');
    expect(adminOnly.length).toBeGreaterThan(0);
    for (const article of adminOnly) {
      expect(screen.queryByText(article.question)).not.toBeInTheDocument();
    }
  });

  it('shows articles marked for every audience in both portals', () => {
    const shared = allArticles.filter((article) => article.audience === 'all');
    expect(shared.length).toBeGreaterThan(0);

    const { unmount } = render(<HelpCenterContent audience="admin" />);
    for (const article of shared) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }
    unmount();

    render(<HelpCenterContent audience="worker" />);
    for (const article of shared) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }
  });

  it('renders every category and article on the public (all-audience) page', () => {
    render(<HelpCenterContent audience="all" />);

    for (const category of HELP_CATEGORIES) {
      expect(screen.getByRole('heading', { name: category.title })).toBeInTheDocument();
    }
    for (const article of allArticles) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }
  });
});

describe('HelpCenterContent — search', () => {
  it('shows every article by default (empty query)', () => {
    render(<HelpCenterContent audience="all" />);

    for (const article of allArticles) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }
  });

  it('filters the list by a question-text match', async () => {
    const user = userEvent.setup();
    const target = bySlug('find-my-certificates');
    const term = uniqueSearchTerm(target, allArticles);

    render(<HelpCenterContent audience="all" />);
    await user.type(searchBox(), term);

    expect(screen.getByText(target.question)).toBeInTheDocument();
    for (const article of allArticles.filter((a) => a.slug !== target.slug)) {
      expect(screen.queryByText(article.question)).not.toBeInTheDocument();
    }
  });

  it('filters by a match in the answer body, not just the question', async () => {
    const user = userEvent.setup();
    const target = bySlug('create-a-course');
    const term = uniqueSearchTerm(target, allArticles, { bodyOnly: true });

    render(<HelpCenterContent audience="all" />);
    await user.type(searchBox(), term);

    expect(screen.getByText(target.question)).toBeInTheDocument();
    for (const article of allArticles.filter((a) => a.slug !== target.slug)) {
      expect(screen.queryByText(article.question)).not.toBeInTheDocument();
    }
  });

  it('search is case-insensitive', async () => {
    const user = userEvent.setup();
    const target = bySlug('password-reset-prompt');
    const term = uniqueSearchTerm(target, allArticles);

    render(<HelpCenterContent audience="all" />);
    await user.type(searchBox(), term.toUpperCase());

    expect(screen.getByText(target.question)).toBeInTheDocument();
  });

  it('shows an empty state for a query matching nothing, quoting the query back', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent audience="all" />);

    await user.type(searchBox(), 'xyznonsense');

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.getByText(/xyznonsense/)).toBeInTheDocument();
    for (const article of allArticles) {
      expect(screen.queryByText(article.question)).not.toBeInTheDocument();
    }
  });

  it('restores the full list when the query is cleared', async () => {
    const user = userEvent.setup();
    render(<HelpCenterContent audience="all" />);

    const input = searchBox();
    await user.type(input, 'xyznonsense');
    expect(screen.getByText('No results found')).toBeInTheDocument();

    await user.clear(input);

    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    for (const article of allArticles) {
      expect(screen.getByText(article.question)).toBeInTheDocument();
    }
  });
});

describe('HelpCenterContent — answers', () => {
  it('reveals the answer body when a question is expanded', async () => {
    const user = userEvent.setup();
    const target = bySlug('store-clinical-documents');

    render(<HelpCenterContent audience="all" />);

    expect(screen.queryByText(/Protected Health Information/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: target.question }));

    expect(screen.getByText(/Protected Health Information/)).toBeInTheDocument();
  });

  it('renders **bold** markers as emphasis rather than literal asterisks', async () => {
    const user = userEvent.setup();
    const target = bySlug('store-clinical-documents');

    render(<HelpCenterContent audience="all" />);
    await user.click(screen.getByRole('button', { name: target.question }));

    expect(screen.getByText('No.').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('lists every billing tier inside the pricing answer', async () => {
    const user = userEvent.setup();
    const target = bySlug('how-pricing-works');

    render(<HelpCenterContent audience="all" />);
    await user.click(screen.getByRole('button', { name: target.question }));

    for (const plan of BILLING_PLANS) {
      expect(screen.getByText(plan.name)).toBeInTheDocument();
    }
  });

  it('shows supplied plan price labels in the pricing answer', async () => {
    const user = userEvent.setup();
    const target = bySlug('how-pricing-works');

    render(
      <HelpCenterContent
        audience="all"
        planPricing={[{ key: 'starter', monthlyLabel: '$100 / mo', annualLabel: '$80 / mo' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: target.question }));

    expect(screen.getByText('$100 / mo')).toBeInTheDocument();
    expect(screen.getByText('$80 / mo')).toBeInTheDocument();
  });
});
