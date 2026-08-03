import { BILLING_PLANS } from '@/lib/billing-plans';

/**
 * Who a help article is written for. `'all'` articles surface in every portal
 * (e.g. the PHI policy, which binds admins and workers alike).
 */
export type HelpAudience = 'admin' | 'worker' | 'all';

export interface HelpArticle {
  slug: string;
  question: string;
  audience: HelpAudience;
  /** Leading paragraph. Supports `**bold**` markers. */
  intro?: string;
  /** Ordered instructions. Each entry supports `**bold**` markers. */
  steps?: string[];
  /** Closing paragraph, rendered after the steps. Supports `**bold**` markers. */
  outro?: string;
  /** Renders the plan lineup (derived from the billing registry) inside the answer. */
  pricingTable?: boolean;
}

export interface HelpCategory {
  slug: string;
  title: string;
  articles: HelpArticle[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    slug: 'staff-team-management',
    title: 'Staff & Team Management',
    articles: [
      {
        slug: 'onboard-workers',
        question: 'How do I onboard workers?',
        audience: 'admin',
        steps: [
          'Navigate to **Staff Management**.',
          'Click **Add Worker**.',
          "Enter the worker's email address (or upload a CSV file using our standard template for bulk additions).",
          'Select their role.',
          'Click **Submit**. An invitation link will be sent to the worker automatically.',
        ],
      },
    ],
  },
  {
    slug: 'course-training-management',
    title: 'Course & Training Management',
    articles: [
      {
        slug: 'create-a-course',
        question: 'How do I create a course?',
        audience: 'admin',
        steps: [
          'Navigate to **Courses**.',
          'Click **Create Course** and select a course category.',
          'Upload your source material (PDF, DOCX, or PPTX).',
          'Let the **AI Wizard** automatically generate the course content.',
          'Review and configure your course settings.',
          'Assign the course to workers and click **Submit**.',
        ],
      },
      {
        slug: 'assign-courses',
        question: 'How do I assign courses?',
        audience: 'admin',
        steps: [
          'Navigate to **Courses**.',
          'Select the course you want to assign and click the **Assign** button.',
          'Enter individual worker emails or upload a bulk CSV file.',
          'Click **Submit**.',
        ],
      },
    ],
  },
  {
    slug: 'document-storage-compliance',
    title: 'Document Storage & Compliance',
    articles: [
      {
        slug: 'store-organizational-documents',
        question: 'Can I store organizational documents on the platform?',
        audience: 'admin',
        intro:
          'Yes. The **Documents** section allows you to store operational files, policies, certifications, and compliance records needed to run your organization.',
        steps: [
          'Navigate to **Documents**.',
          'Open or select the relevant folder.',
          'Click **Upload Document** and select your file.',
          'Click **Submit**.',
        ],
      },
      {
        slug: 'store-clinical-documents',
        question: 'Can I store clinical documents or patient records on the platform?',
        audience: 'all',
        intro:
          '**No.** Theraptly is built specifically as the operational and compliance management layer for your organization. To ensure strict alignment with HIPAA regulations, uploading Protected Health Information (PHI) or clinical patient records to the platform is restricted.',
      },
      {
        slug: 'download-audit-reports',
        question: 'How do I download compliance and audit reports?',
        audience: 'admin',
        steps: [
          'Navigate to **Audit Reports**.',
          'Select either the **Courses** or **Workers** tab.',
          'Click the **Export** button next to the desired course or worker to download your PDF audit report.',
        ],
      },
    ],
  },
  {
    slug: 'billing-subscriptions',
    title: 'Billing & Subscriptions',
    articles: [
      {
        slug: 'how-pricing-works',
        question: 'How does pricing work?',
        audience: 'admin',
        intro:
          'Unlike traditional healthcare software that charges per seat — causing unpredictable monthly bills as your team fluctuates — Theraptly charges in **headcount bands**. This keeps your costs predictable and allows you to plan your budget with confidence.',
        pricingTable: true,
      },
      {
        slug: 'reaching-your-worker-limit',
        question: 'What happens when I hit my worker limit / pricing tier?',
        audience: 'admin',
        intro:
          'When you reach the maximum headcount for your current plan, you will be prompted to upgrade to the next tier before adding new workers. **Your current active team will experience zero disruption or service loss.**',
      },
      {
        slug: 'subscribe-to-a-plan',
        question: 'How do I subscribe to a plan?',
        audience: 'admin',
        steps: [
          'From your **Home Dashboard**, navigate to **Billing**.',
          'Select the **Subscriptions** tab.',
          'Choose your desired headcount tier.',
          'Enter your card details to complete payment.',
        ],
      },
      {
        slug: 'cancel-subscription',
        question: 'How do I cancel my subscription?',
        audience: 'admin',
        intro: 'You can cancel your subscription at any time:',
        steps: [
          'Navigate to **Billing**.',
          'Select the **Subscriptions** tab.',
          'Click **Cancel Subscription**.',
        ],
        outro:
          'Your plan and access will remain active through the end of your current paid billing cycle.',
      },
    ],
  },
  {
    slug: 'using-your-training-portal',
    title: 'Using Your Training Portal',
    articles: [
      {
        slug: 'start-an-assigned-training',
        question: 'How do I start an assigned training?',
        audience: 'worker',
        intro:
          'Open the Trainings section from the sidebar, pick a course from your assigned list, and select Start to begin. Your progress is saved automatically as you go.',
      },
      {
        slug: 'find-my-certificates',
        question: 'Where can I find my certificates?',
        audience: 'worker',
        intro:
          'Completed course certificates appear under the Certificates section. You can view or download each certificate once the course and its quiz are passed.',
      },
      {
        slug: 'failed-quiz',
        question: 'What happens if I fail a quiz?',
        audience: 'worker',
        intro:
          'You can retake a quiz when a retake is assigned to you. Review the related course material first — your most recent passing attempt is what counts toward completion.',
      },
      {
        slug: 'password-reset-prompt',
        question: 'Why am I being asked to reset my password?',
        audience: 'worker',
        intro:
          'For security, an administrator can require a password reset. Follow the prompt to set a new password; you will then be signed back in automatically.',
      },
      {
        slug: 'update-profile-details',
        question: 'How do I update my profile details?',
        audience: 'worker',
        intro:
          'Open the profile menu from the top-right of any page and select Profile to review or update your account information.',
      },
    ],
  },
];

/**
 * Categories narrowed to the articles a given audience should see. Categories
 * left with no matching article are dropped so no empty section renders.
 */
export function helpCategoriesFor(audience: HelpAudience): HelpCategory[] {
  if (audience === 'all') return HELP_CATEGORIES;

  return HELP_CATEGORIES.map((category) => ({
    ...category,
    articles: category.articles.filter(
      (article) => article.audience === audience || article.audience === 'all',
    ),
  })).filter((category) => category.articles.length > 0);
}

/**
 * Plain-text projection of an article used for search matching: emphasis
 * markers are stripped, and pricing answers also match on plan names/bands so
 * a search for a tier ("Growth") finds the pricing article.
 */
export function helpArticleSearchText(article: HelpArticle): string {
  const parts = [article.question, article.intro, ...(article.steps ?? []), article.outro];

  if (article.pricingTable) {
    parts.push(...BILLING_PLANS.map((plan) => `${plan.name} ${plan.description}`));
  }

  return parts
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .replaceAll('**', '');
}
