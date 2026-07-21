'use client';

import { useMemo, useState } from 'react';
import { Mail, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EmptyTableState from '@/components/ui/EmptyTableState';

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@theraptly.com';

// PLACEHOLDER copy — final product FAQ wording is pending from the product team.
// Replace these entries (not the layout) once approved copy lands.
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'How do I start an assigned training?',
    answer:
      'Open the Trainings section from the sidebar, pick a course from your assigned list, and select Start to begin. Your progress is saved automatically as you go.',
  },
  {
    question: 'Where can I find my certificates?',
    answer:
      'Completed course certificates appear under the Certificates section. You can view or download each certificate once the course and its quiz are passed.',
  },
  {
    question: 'What happens if I fail a quiz?',
    answer:
      'You can retake a quiz when a retake is assigned to you. Review the related course material first — your most recent passing attempt is what counts toward completion.',
  },
  {
    question: 'Why am I being asked to reset my password?',
    answer:
      'For security, an administrator can require a password reset. Follow the prompt to set a new password; you will then be signed back in automatically.',
  },
  {
    question: 'How do I update my profile details?',
    answer:
      'Open the profile menu from the top-right of any page and select Profile to review or update your account information.',
  },
];

export default function HelpCenterContent() {
  const [query, setQuery] = useState('');

  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_ITEMS;
    return FAQ_ITEMS.filter(
      (item) => item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q),
    );
  }, [query]);

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

      <section>
        <h2 className="mb-4 text-base font-semibold text-foreground">Frequently asked questions</h2>
        {filteredFaq.length === 0 ? (
          <div className="rounded-xl border border-border bg-background">
            <EmptyTableState
              message="No results found"
              subMessage={`We couldn't find anything matching "${query.trim()}". Try a different search, or email our support team above.`}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredFaq.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl border border-border bg-background p-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-foreground">
                  {item.question}
                  <ChevronDown className="size-4 flex-shrink-0 text-text-secondary transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm text-text-secondary">{item.answer}</p>
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
