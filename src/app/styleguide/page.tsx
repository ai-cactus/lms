'use client';

import {
  colors,
  fontFamilies,
  fontSizes,
  fontWeights,
  spacing,
  borderRadius,
  shadows,
  breakpoints,
  typography,
} from '@/style/design-tokens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, PasswordInput, Alert, OtpInput, Logo, RowActionsMenu } from '@/components/ui';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Mail, Lock, User, Eye, Pencil, Trash2 } from 'lucide-react';
import styles from './page.module.css';

export default function StyleGuidePage() {
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Design System</h1>
        <p className={styles.subtitle}>
          A comprehensive style guide with design tokens extracted from Figma
        </p>
      </header>

      <main className={styles.content}>
        {/* Colors Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Colors</h2>
          <p className={styles.sectionDescription}>
            Color palette with semantic naming for consistent usage across the application
          </p>

          {/* Gray Colors */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>
              <span>Gray / Neutral</span>
            </h3>
            <div className={styles.colorGrid}>
              {Object.entries(colors.gray).map(([scale, hex]) => (
                <div key={`gray-${scale}`} className={styles.colorSwatch}>
                  <div className={styles.colorPreview} style={{ backgroundColor: hex }} />
                  <div className={styles.colorInfo}>
                    <div className={styles.colorScale}>{scale}</div>
                    <div className={styles.colorHex}>{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Brand Colors */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>
              <span>Brand / Primary</span>
            </h3>
            <div className={styles.colorGrid}>
              {Object.entries(colors.brand).map(([scale, hex]) => (
                <div key={`brand-${scale}`} className={styles.colorSwatch}>
                  <div className={styles.colorPreview} style={{ backgroundColor: hex }} />
                  <div className={styles.colorInfo}>
                    <div className={styles.colorScale}>{scale}</div>
                    <div className={styles.colorHex}>{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Destructive Colors */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>
              <span>Destructive / Error</span>
            </h3>
            <div className={styles.colorGrid}>
              {Object.entries(colors.destructive).map(([scale, hex]) => (
                <div key={`destructive-${scale}`} className={styles.colorSwatch}>
                  <div className={styles.colorPreview} style={{ backgroundColor: hex }} />
                  <div className={styles.colorInfo}>
                    <div className={styles.colorScale}>{scale}</div>
                    <div className={styles.colorHex}>{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning Colors */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>
              <span>Warning</span>
            </h3>
            <div className={styles.colorGrid}>
              {Object.entries(colors.warning).map(([scale, hex]) => (
                <div key={`warning-${scale}`} className={styles.colorSwatch}>
                  <div className={styles.colorPreview} style={{ backgroundColor: hex }} />
                  <div className={styles.colorInfo}>
                    <div className={styles.colorScale}>{scale}</div>
                    <div className={styles.colorHex}>{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Success Colors */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>
              <span>Success</span>
            </h3>
            <div className={styles.colorGrid}>
              {Object.entries(colors.success).map(([scale, hex]) => (
                <div key={`success-${scale}`} className={styles.colorSwatch}>
                  <div className={styles.colorPreview} style={{ backgroundColor: hex }} />
                  <div className={styles.colorInfo}>
                    <div className={styles.colorScale}>{scale}</div>
                    <div className={styles.colorHex}>{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Typography Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Typography</h2>
          <p className={styles.sectionDescription}>
            Font families, sizes, and weights for consistent text styling
          </p>

          {/* Font Families */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>Font Families</h3>
            <div className={styles.fontFamilyGrid}>
              <div className={styles.fontFamilyItem}>
                <div className={styles.fontFamilyName}>Primary (Inter)</div>
                <div className={styles.fontFamilyStack}>{fontFamilies.primary}</div>
                <div
                  className={styles.fontFamilySample}
                  style={{ fontFamily: fontFamilies.primary }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
              </div>
              <div className={styles.fontFamilyItem}>
                <div className={styles.fontFamilyName}>Monospace (JetBrains Mono)</div>
                <div className={styles.fontFamilyStack}>{fontFamilies.mono}</div>
                <div className={styles.fontFamilySample} style={{ fontFamily: fontFamilies.mono }}>
                  {'const code = "Hello World";'}
                </div>
              </div>
            </div>
          </div>

          {/* Typography Scale */}
          <div className={styles.colorCategory}>
            <h3 className={styles.colorCategoryTitle}>Type Scale</h3>
            <div className={styles.typographyGrid}>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Display</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes['6xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.display as React.CSSProperties}
                >
                  Display
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Heading 1</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes['5xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.h1 as React.CSSProperties}
                >
                  Heading 1
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Heading 2</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes['4xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.h2 as React.CSSProperties}
                >
                  Heading 2
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Heading 3</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes['3xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.h3 as React.CSSProperties}
                >
                  Heading 3
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Heading 4</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes['2xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.h4 as React.CSSProperties}
                >
                  Heading 4
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Body Large</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes.lg.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.bodyLarge as React.CSSProperties}
                >
                  Body large text for important paragraphs
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Body</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes.base.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.body as React.CSSProperties}
                >
                  Default body text for general content and descriptions
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Body Small</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes.sm.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.bodySmall as React.CSSProperties}
                >
                  Small body text for secondary information
                </div>
              </div>
              <div className={styles.typographyItem}>
                <div className={styles.typographyMeta}>
                  <div className={styles.typographyName}>Caption</div>
                  <div className={styles.typographySpecs}>
                    {fontSizes.xs.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className={styles.typographySample}
                  style={typography.caption as React.CSSProperties}
                >
                  Caption text for labels and metadata
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Spacing Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Spacing</h2>
          <p className={styles.sectionDescription}>Consistent spacing scale using 4px base unit</p>
          <div className={styles.spacingGrid}>
            {[0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((key) => {
              const value = spacing[key as keyof typeof spacing];
              const height = parseInt(value) || 2;
              return (
                <div key={key} className={styles.spacingItem}>
                  <div
                    className={styles.spacingBar}
                    style={{ height: Math.max(height, 4), width: 32 }}
                  />
                  <div className={styles.spacingLabel}>{key}</div>
                  <div className={styles.spacingValue}>{value}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Border Radius Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Border Radius</h2>
          <p className={styles.sectionDescription}>
            Rounded corner values for consistent component styling
          </p>
          <div className={styles.radiusGrid}>
            {Object.entries(borderRadius).map(([name, value]) => (
              <div key={name} className={styles.radiusItem}>
                <div className={styles.radiusPreview} style={{ borderRadius: value }} />
                <div className={styles.radiusLabel}>{name}</div>
                <div className={styles.radiusValue}>{value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Shadows Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shadows</h2>
          <p className={styles.sectionDescription}>Elevation system for depth and hierarchy</p>
          <div className={styles.shadowGrid}>
            {Object.entries(shadows)
              .slice(0, 8)
              .map(([name, value]) => (
                <div key={name} className={styles.shadowItem}>
                  <div className={styles.shadowPreview} style={{ boxShadow: value }} />
                  <div className={styles.shadowLabel}>{name}</div>
                </div>
              ))}
          </div>
        </section>

        {/* Breakpoints Section */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Breakpoints</h2>
          <p className={styles.sectionDescription}>Responsive breakpoints for media queries</p>
          <div className={styles.breakpointGrid}>
            {Object.entries(breakpoints).map(([name, value]) => {
              const numValue = parseInt(value);
              const maxWidth = 1536;
              const percentage = (numValue / maxWidth) * 100;
              return (
                <div key={name} className={styles.breakpointItem}>
                  <div className={styles.breakpointName}>{name}</div>
                  <div className={styles.breakpointValue}>{value}</div>
                  <div
                    className={styles.breakpointBar}
                    style={{ '--width': `${percentage}%` } as React.CSSProperties}
                  />
                </div>
              );
            })}
          </div>
        </section>
        {/* New shadcn primitives — auth slice */}
        <section className="flex flex-col gap-10 py-8">
          <div>
            <h2 className="text-xl font-semibold">Components</h2>
            <p className="mt-1 text-sm text-text-secondary">
              shadcn + Tailwind primitives used across the app. See{' '}
              <code className="rounded bg-background-secondary px-1.5 py-0.5 text-xs">
                docs/ui-migration-pattern.md
              </code>
              .
            </p>
          </div>

          {/* Logo */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">Logo</h3>
            <div className="flex flex-wrap items-end gap-8">
              <Logo size="sm" />
              <Logo size="md" />
              <Logo size="lg" />
            </div>
          </div>

          {/* Buttons — sizes */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">Button sizes</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button>Default (44px)</Button>
              <Button size="lg">Large (48px)</Button>
            </div>
          </div>

          {/* Buttons — variants */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">Button variants</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary (hover to fill)</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </div>
          </div>

          {/* Buttons — states */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              Button states — grey until requirements are met, colour while loading
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Active</Button>
              <Button disabled>Disabled (requirements unmet)</Button>
              <Button loading>Loading</Button>
              <Button size="lg" className="w-full max-w-xs" loading>
                Full-width loading
              </Button>
            </div>
          </div>

          {/* Form controls */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">Form controls (56px)</h3>
            <div className="flex max-w-md flex-col gap-4">
              <Field label="Full name">
                <Input placeholder="Jane Doe" startIcon={<User aria-hidden="true" />} />
              </Field>
              <Field label="Email" helperText="We never share this.">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  startIcon={<Mail aria-hidden="true" />}
                />
              </Field>
              <Field label="Email" error="Please enter a valid email">
                <Input
                  type="email"
                  placeholder="you@example.com"
                  defaultValue="bad"
                  startIcon={<Mail aria-hidden="true" />}
                />
              </Field>
              <Field label="Password">
                <PasswordInput
                  placeholder="Enter your password"
                  startIcon={<Lock aria-hidden="true" />}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <Checkbox defaultChecked /> Remember me
              </label>
            </div>
          </div>

          {/* OTP */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">One-time code</h3>
            <OtpInput value="12" onChange={() => {}} />
          </div>

          {/* Table + kebab */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">
              Table + row actions (kebab)
            </h3>
            <div className="overflow-hidden rounded-xl border border-[#e2e8f0]">
              <Table>
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="rounded-l-lg">Course Name</TableHead>
                    <TableHead>Completion</TableHead>
                    <TableHead className="rounded-r-lg text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {['HIPAA Privacy Training', 'Workplace Safety', 'Incident Reporting'].map(
                    (name) => (
                      <TableRow key={name}>
                        <TableCell className="font-semibold text-[#0f172a]">{name}</TableCell>
                        <TableCell>80%</TableCell>
                        <TableCell className="text-right">
                          <RowActionsMenu
                            actions={[
                              { label: 'View', icon: <Eye className="size-4" /> },
                              { label: 'Edit', icon: <Pencil className="size-4" /> },
                              {
                                label: 'Delete',
                                icon: <Trash2 className="size-4" />,
                                variant: 'destructive',
                                separatorBefore: true,
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    ),
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Alerts */}
          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-text-secondary">Alerts</h3>
            <div className="flex max-w-md flex-col gap-3">
              <Alert variant="success" title="Email verified successfully!">
                Please log in to continue.
              </Alert>
              <Alert variant="error" title="Access Denied">
                You do not have authorization to log in with this role.
              </Alert>
              <Alert variant="warning" title="Session Expired">
                You were logged out due to inactivity.
              </Alert>
              <Alert variant="info" title="Account created successfully!">
                Please log in.
              </Alert>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
