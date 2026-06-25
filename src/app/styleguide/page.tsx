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

export default function StyleGuidePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background-secondary to-background px-4 py-8 sm:px-6 sm:py-12">
      <header className="mx-auto mb-16 max-w-[1200px] text-center">
        <h1 className="mb-3 text-[32px] font-semibold tracking-tight text-foreground sm:text-5xl">
          Design System
        </h1>
        <p className="mx-auto max-w-[600px] text-base text-text-secondary sm:text-lg">
          A comprehensive style guide with design tokens extracted from Figma
        </p>
      </header>

      <main className="mx-auto max-w-[1200px]">
        {/* Colors Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">Colors</h2>
          <p className="mb-6 text-sm text-text-secondary">
            Color palette with semantic naming for consistent usage across the application
          </p>

          {/* Gray Colors */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              <span>Gray / Neutral</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
              {Object.entries(colors.gray).map(([scale, hex]) => (
                <div
                  key={`gray-${scale}`}
                  className="flex flex-col overflow-hidden rounded-xl bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-[72px] w-full" style={{ backgroundColor: hex }} />
                  <div className="p-2.5 text-center">
                    <div className="mb-0.5 text-xs font-semibold text-text-secondary">{scale}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Brand Colors */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              <span>Brand / Primary</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
              {Object.entries(colors.brand).map(([scale, hex]) => (
                <div
                  key={`brand-${scale}`}
                  className="flex flex-col overflow-hidden rounded-xl bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-[72px] w-full" style={{ backgroundColor: hex }} />
                  <div className="p-2.5 text-center">
                    <div className="mb-0.5 text-xs font-semibold text-text-secondary">{scale}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Destructive Colors */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              <span>Destructive / Error</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
              {Object.entries(colors.destructive).map(([scale, hex]) => (
                <div
                  key={`destructive-${scale}`}
                  className="flex flex-col overflow-hidden rounded-xl bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-[72px] w-full" style={{ backgroundColor: hex }} />
                  <div className="p-2.5 text-center">
                    <div className="mb-0.5 text-xs font-semibold text-text-secondary">{scale}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Warning Colors */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              <span>Warning</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
              {Object.entries(colors.warning).map(([scale, hex]) => (
                <div
                  key={`warning-${scale}`}
                  className="flex flex-col overflow-hidden rounded-xl bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-[72px] w-full" style={{ backgroundColor: hex }} />
                  <div className="p-2.5 text-center">
                    <div className="mb-0.5 text-xs font-semibold text-text-secondary">{scale}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Success Colors */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              <span>Success</span>
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(100px,1fr))]">
              {Object.entries(colors.success).map(([scale, hex]) => (
                <div
                  key={`success-${scale}`}
                  className="flex flex-col overflow-hidden rounded-xl bg-background shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-[72px] w-full" style={{ backgroundColor: hex }} />
                  <div className="p-2.5 text-center">
                    <div className="mb-0.5 text-xs font-semibold text-text-secondary">{scale}</div>
                    <div className="font-mono text-[10px] text-text-tertiary">{hex}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Typography Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">
            Typography
          </h2>
          <p className="mb-6 text-sm text-text-secondary">
            Font families, sizes, and weights for consistent text styling
          </p>

          {/* Font Families */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              Font Families
            </h3>
            <div className="flex flex-col gap-5">
              <div className="rounded-xl bg-background p-6 shadow-sm">
                <div className="mb-1 text-sm font-semibold text-text-secondary">
                  Primary (Inter)
                </div>
                <div className="mb-4 break-all font-mono text-[11px] text-text-tertiary">
                  {fontFamilies.primary}
                </div>
                <div
                  className="text-[32px] text-foreground"
                  style={{ fontFamily: fontFamilies.primary }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
              </div>
              <div className="rounded-xl bg-background p-6 shadow-sm">
                <div className="mb-1 text-sm font-semibold text-text-secondary">
                  Monospace (JetBrains Mono)
                </div>
                <div className="mb-4 break-all font-mono text-[11px] text-text-tertiary">
                  {fontFamilies.mono}
                </div>
                <div
                  className="text-[32px] text-foreground"
                  style={{ fontFamily: fontFamilies.mono }}
                >
                  {'const code = "Hello World";'}
                </div>
              </div>
            </div>
          </div>

          {/* Typography Scale */}
          <div className="mb-10">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-text-secondary">
              Type Scale
            </h3>
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Display</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes['6xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div className="text-foreground" style={typography.display as React.CSSProperties}>
                  Display
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Heading 1</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes['5xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div className="text-foreground" style={typography.h1 as React.CSSProperties}>
                  Heading 1
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Heading 2</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes['4xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div className="text-foreground" style={typography.h2 as React.CSSProperties}>
                  Heading 2
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Heading 3</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes['3xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div className="text-foreground" style={typography.h3 as React.CSSProperties}>
                  Heading 3
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Heading 4</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes['2xl'].px}px / {fontWeights.semibold}
                  </div>
                </div>
                <div className="text-foreground" style={typography.h4 as React.CSSProperties}>
                  Heading 4
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Body Large</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes.lg.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className="text-foreground"
                  style={typography.bodyLarge as React.CSSProperties}
                >
                  Body large text for important paragraphs
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Body</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes.base.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div className="text-foreground" style={typography.body as React.CSSProperties}>
                  Default body text for general content and descriptions
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Body Small</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes.sm.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div
                  className="text-foreground"
                  style={typography.bodySmall as React.CSSProperties}
                >
                  Small body text for secondary information
                </div>
              </div>
              <div className="grid grid-cols-1 items-center gap-3 rounded-xl bg-background p-5 shadow-sm sm:grid-cols-[200px_1fr] sm:gap-6">
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-secondary">Caption</div>
                  <div className="font-mono text-[11px] leading-normal text-text-tertiary">
                    {fontSizes.xs.px}px / {fontWeights.regular}
                  </div>
                </div>
                <div className="text-foreground" style={typography.caption as React.CSSProperties}>
                  Caption text for labels and metadata
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Spacing Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">Spacing</h2>
          <p className="mb-6 text-sm text-text-secondary">
            Consistent spacing scale using 4px base unit
          </p>
          <div className="flex flex-wrap items-end gap-4">
            {[0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64].map((key) => {
              const value = spacing[key as keyof typeof spacing];
              const height = parseInt(value) || 2;
              return (
                <div key={key} className="flex flex-col items-center gap-2">
                  <div
                    className="min-w-8 rounded bg-gradient-to-br from-primary to-primary"
                    style={{ height: Math.max(height, 4), width: 32 }}
                  />
                  <div className="text-center font-mono text-[10px] text-text-tertiary">{key}</div>
                  <div className="font-mono text-[9px] text-text-tertiary">{value}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Border Radius Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">
            Border Radius
          </h2>
          <p className="mb-6 text-sm text-text-secondary">
            Rounded corner values for consistent component styling
          </p>
          <div className="flex flex-wrap gap-5">
            {Object.entries(borderRadius).map(([name, value]) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <div
                  className="flex size-20 items-center justify-center bg-gradient-to-br from-primary to-primary"
                  style={{ borderRadius: value }}
                />
                <div className="text-xs font-medium text-text-secondary">{name}</div>
                <div className="font-mono text-[10px] text-text-tertiary">{value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Shadows Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">Shadows</h2>
          <p className="mb-6 text-sm text-text-secondary">
            Elevation system for depth and hierarchy
          </p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6">
            {Object.entries(shadows)
              .slice(0, 8)
              .map(([name, value]) => (
                <div key={name} className="flex flex-col items-center gap-3">
                  <div
                    className="flex h-20 w-[120px] items-center justify-center rounded-xl bg-background"
                    style={{ boxShadow: value }}
                  />
                  <div className="text-[13px] font-medium text-text-secondary">{name}</div>
                </div>
              ))}
          </div>
        </section>

        {/* Breakpoints Section */}
        <section className="mb-16">
          <h2 className="mb-2 text-[28px] font-semibold tracking-tight text-foreground">
            Breakpoints
          </h2>
          <p className="mb-6 text-sm text-text-secondary">
            Responsive breakpoints for media queries
          </p>
          <div className="flex flex-col gap-3">
            {Object.entries(breakpoints).map(([name, value]) => {
              const numValue = parseInt(value);
              const maxWidth = 1536;
              const percentage = (numValue / maxWidth) * 100;
              return (
                <div
                  key={name}
                  className="flex items-center gap-4 rounded-lg bg-background px-5 py-4 shadow-sm"
                >
                  <div className="min-w-[60px] text-sm font-semibold text-text-secondary">
                    {name}
                  </div>
                  <div className="min-w-[80px] font-mono text-[13px] text-primary">{value}</div>
                  <div
                    className="h-2 flex-1 rounded bg-[linear-gradient(90deg,var(--color-primary)_var(--width),var(--color-border)_var(--width))]"
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
