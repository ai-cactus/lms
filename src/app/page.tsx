import HowItWorks from './_components/HowItWorks';
import InspectorsSection from './_components/InspectorsSection';
import FeatureSection from './_components/FeatureSection';
import Image from 'next/image';
import Link from 'next/link';
import FeatureAccordion from './_components/FeatureAccordion';
import Footer from './_components/Footer';
import ClientTypingEffect from './_components/ClientTypingEffect';

export default function Home() {
  return (
    <>
      <main className="flex min-h-screen flex-col overflow-x-hidden bg-background-secondary">
        {/* Header section */}
        <header className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-5 py-4 md:px-8 md:py-6">
          <div className="flex-1">
            <Image src="/images/logo.svg" alt="Theraptly Logo" width={140} height={32} priority />
          </div>

          <nav className="hidden flex-1 items-center justify-center gap-8 md:flex">
            <Link
              href="#features"
              className="flex items-center gap-1 text-[15px] font-medium text-foreground transition-colors hover:text-primary"
            >
              Features
            </Link>
          </nav>

          <div className="flex flex-none items-center justify-end gap-2 md:flex-1 md:gap-4">
            <Link
              href="/login"
              className="rounded-[10px] border border-border bg-background px-4 py-2.5 text-[13px] font-medium text-foreground transition-all hover:border-text-tertiary hover:bg-background-secondary sm:px-5 sm:text-sm"
            >
              Sign in
            </Link>
            <Link
              href="/request-demo"
              className="hidden rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 md:inline-block"
            >
              Request a Demo
            </Link>
          </div>
        </header>

        {/* Hero section */}
        <section className="mx-auto mb-3 mt-6 flex max-w-[960px] flex-col items-center px-6 text-center sm:mb-6 sm:mt-12">
          <div className="mb-8 inline-flex cursor-pointer flex-wrap items-center justify-start gap-3 rounded-full border border-border-light bg-background py-1.5 pl-1.5 pr-4 text-left text-[13px] font-medium text-text-secondary shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-transform hover:-translate-y-px hover:shadow-md">
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
              New
            </span>
            <span>Theraptly LMS: &rarr;</span>
          </div>

          <h1 className="mb-6 max-w-[900px] text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-foreground sm:text-4xl md:text-5xl lg:text-[64px]">
            Be ready when inspectors ask for staff training
            <p>
              <ClientTypingEffect />
            </p>
          </h1>

          <p className="mb-10 max-w-[720px] px-4 text-base leading-relaxed text-text-secondary sm:px-0 sm:text-lg">
            Theraptly turns your clinic policies into structured staff training — with timestamped
            completion records you can export the moment they are requested. No spreadsheets. No
            chasing staff. No scrambling before surveys.
          </p>

          <div className="flex w-full flex-col items-center justify-center gap-4 px-6 sm:w-auto sm:flex-row sm:px-0">
            <Link
              href="/signup"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#1a1a1a] px-8 py-4 text-base font-semibold text-white shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] transition-all hover:-translate-y-0.5 hover:bg-black hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] sm:w-auto"
            >
              Start for free &rarr;
            </Link>
            <Link
              href="/request-demo"
              className="inline-flex w-full items-center justify-center rounded-full bg-border-light px-8 py-4 text-base font-semibold text-foreground transition-all hover:bg-[#e5e7eb] sm:w-auto"
            >
              Request Demo
            </Link>
          </div>
        </section>

        {/* Hero Images Showcase */}
        <section className="relative mx-auto -mt-3 flex w-full max-w-[1600px] justify-center md:min-h-[600px] lg:min-h-[800px]">
          {/* Abstract 3D Fluid Background */}
          <div className="absolute top-0 hidden w-[120%] max-w-[1400px] -translate-y-[2%] md:block">
            <Image
              src="/images/3d_background.png"
              alt="Abstract 3D blue fluid background shape"
              width={1800}
              height={1000}
              className="h-auto w-full object-contain"
              priority
            />
          </div>

          {/* Dashboard Mockup layered over */}
          <div className="relative z-[2] mt-6 w-[92%] max-w-[1080px] overflow-hidden rounded-xl border border-white/50 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] md:mt-[100px] md:rounded-[20px] md:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] lg:mt-[140px] lg:w-[90%]">
            <Image
              src="/images/hero-shot-new.png"
              alt="Theraptly LMS dashboard preview"
              width={1080}
              height={800}
              className="block h-auto w-full"
              priority
            />
          </div>
        </section>
        {/* Features Section */}
        <FeatureSection />

        {/* Pain Points Section */}
        <section className="flex justify-center bg-background px-4 pb-12 sm:px-6 lg:pb-20">
          <div className="flex w-full max-w-[1200px] flex-col items-stretch gap-7 rounded-2xl bg-[#f6f6f5] p-7 sm:gap-10 sm:rounded-3xl sm:p-10 lg:flex-row lg:gap-16 lg:p-16">
            <div className="flex flex-1 flex-col justify-center">
              <h2 className="mb-4 text-[28px] font-bold leading-tight tracking-[-0.02em] text-[#0b1a38] sm:text-[40px]">
                Training usually happens,
                <br />
                but documentation is often
                <br />
                unorganized.
              </h2>
              <p className="mb-8 text-base leading-relaxed text-[#2d4846] sm:text-lg">
                When inspectors ask for proof, most clinics start digging
                <br />
                through:
              </p>
              <ul className="flex list-none flex-col items-start gap-4">
                {[
                  'Excel spreadsheets',
                  'Email threads with certificates',
                  'Shared drive folders',
                  'Incomplete records',
                  'Missing timestamps',
                ].map((item) => (
                  <li
                    key={item}
                    className="inline-flex items-center gap-3 rounded-full bg-white py-2.5 pl-4 pr-6 text-sm font-medium text-[#1b3d36] shadow-sm sm:text-base"
                  >
                    <span className="size-2 rounded-full bg-[#a899df]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex max-h-[240px] flex-1 overflow-hidden rounded-2xl lg:max-h-none">
              <Image
                src="/images/background.png"
                alt="Medical professionals reviewing documents"
                width={600}
                height={500}
                className="h-full w-full rounded-2xl object-cover"
              />
            </div>
          </div>
        </section>

        {/* Inspectors Section */}
        <InspectorsSection />

        {/* How It Works Section */}
        <HowItWorks />

        {/* Advantage Section */}
        <section className="relative flex min-h-[400px] w-full items-end bg-[url('/images/our-advantage.png')] bg-cover bg-[center_20%] sm:min-h-[460px] lg:h-[80vh] lg:min-h-[600px]">
          <div className="flex w-full justify-center bg-[linear-gradient(to_top,rgba(7,13,25,0.95)_0%,rgba(7,13,25,0.6)_50%,rgba(0,0,0,0)_100%)] px-5 pb-12 pt-20 sm:px-6 lg:px-6 lg:pb-[60px] lg:pt-[120px]">
            <div className="w-full max-w-[900px] text-center text-white">
              <h2 className="mb-6 text-2xl font-semibold tracking-[-0.02em] sm:text-[28px] lg:text-[42px]">
                Built for small teams
              </h2>
              <p className="mb-10 max-w-[800px] text-sm leading-[1.7] text-[#d1d5db] sm:text-[15px] lg:text-base">
                Built for Small Compliance Teams. Large hospital systems have compliance
                departments.
                <br />
                Most behavioral health facilities don&apos;t. Theraptly is designed for the facility
                manager managing scheduling, billing, and incident reports,
                <br />
                without adding another operational burden. Setup takes only 15 mins.
              </p>
              <div className="flex items-center justify-center gap-3 text-lg font-bold text-[#9ca3af] sm:text-[22px]">
                <Image
                  src="/images/logo-icon.svg"
                  alt="Theraptly Logo Icon"
                  width={32}
                  height={32}
                  className="[filter:brightness(0)_invert(0.6)]"
                />
                <span>Theraptly</span>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Accordion Section */}
        <FeatureAccordion />

        {/* CTA Section */}
        <section className="relative flex w-full justify-center overflow-hidden bg-primary bg-[url('/images/cta-frame.png')] bg-cover bg-center bg-blend-multiply px-6 py-[70px] lg:py-[100px]">
          <div className="relative z-10 flex w-full max-w-[1200px] items-center">
            <div className="relative z-[2] max-w-[550px] text-white">
              <h2 className="mb-6 text-[28px] font-bold leading-tight tracking-[-0.01em] sm:text-[32px] lg:text-5xl">
                Work smarter, Stay Compliant with Theraptly
              </h2>
              <p className="mb-8 text-[17px] leading-relaxed text-white/90 sm:mb-10 sm:text-xl">
                Start automating tasks today and give your team more time to focus on what matters.
              </p>
              <Link
                href="/request-demo"
                className="inline-flex w-full items-center justify-center rounded-full bg-white px-9 py-4 text-base font-semibold text-[#0b1a38] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] sm:w-auto"
              >
                Request a demo
              </Link>
            </div>
            <Image
              src="/images/Logomark.svg"
              alt=""
              width={700}
              height={700}
              className="pointer-events-none absolute right-[-50%] top-[40%] z-[1] h-auto w-[500px] -translate-y-full opacity-15 sm:right-[-25%] sm:w-[600px] sm:opacity-50 lg:right-[-5%]"
            />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
