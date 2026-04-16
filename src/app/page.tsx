import HowItWorks from './_components/HowItWorks';
import InspectorsSection from './_components/InspectorsSection';
import FeatureSection from './_components/FeatureSection';
import Image from 'next/image';
import Link from 'next/link';
import styles from './page.module.css';
import FeatureAccordion from './_components/FeatureAccordion';
import Footer from './_components/Footer';
import ClientTypingEffect from './_components/ClientTypingEffect';

export default function Home() {
  return (
    <>
      <main className={styles.pageContainer}>
        {/* Header section */}
        <header className={styles.header}>
          <div className={styles.logo}>
            <Image src="/images/logo.svg" alt="Theraptly Logo" width={140} height={32} priority />
          </div>

          <nav className={styles.nav}>
            <Link href="#features" className={styles.navLink}>
              Features
            </Link>
            <Link href="#blog" className={styles.navLink}>
              Blog
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginLeft: 2, opacity: 0.6 }}
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Link>
          </nav>

          <div className={styles.headerActions}>
            <Link href="/login" className={styles.btnSignIn}>
              Sign in
            </Link>
            <Link href="/request-demo" className={styles.btnDemo}>
              Request a Demo
            </Link>
          </div>
        </header>

        {/* Hero section */}
        <section className={styles.hero}>
          <div className={styles.badgeContainer}>
            <span className={styles.badgeNew}>New</span>
            <span>Theraptly LMS: &rarr;</span>
          </div>

          <h1 className={styles.heroHeadline}>
            Be ready when inspectors ask for staff training
            <p>
              <ClientTypingEffect />
            </p>
          </h1>

          <p className={styles.heroSubtext}>
            Theraptly turns your clinic policies into structured staff training — with timestamped
            completion records you can export the moment they are requested. No spreadsheets. No
            chasing staff. No scrambling before surveys.
          </p>

          <div className={styles.heroActions}>
            <Link href="/signup" className={styles.btnPrimary}>
              Start for free &rarr;
            </Link>
            <Link href="/request-demo" className={styles.btnSecondary}>
              Request Demo
            </Link>
          </div>
        </section>

        {/* Hero Images Showcase */}
        <section className={styles.showcaseContainer}>
          {/* Abstract 3D Fluid Curly Background */}
          <div className={styles.showcaseBackground}>
            <Image
              src="/images/3d_background.png"
              alt="Abstract 3D blue fluid background shape"
              width={1800}
              height={1000}
              className={styles.showcaseImage}
              priority
            />
          </div>

          {/* Dashboard Mockup layered over */}
          <div className={styles.dashboardContainer}>
            <Image
              src="/images/dashboard_image.png"
              alt="Theraptly LMS dashboard preview"
              width={1080}
              height={800}
              className={styles.dashboardImage}
              priority
            />
          </div>
        </section>
        {/* Features Section */}
        <FeatureSection />

        {/* Pain Points Section */}
        <section className={styles.painPointsSection}>
          <div className={styles.painPointsContainer}>
            <div className={styles.painPointsContent}>
              <h2 className={styles.painPointsTitle}>
                Training usually happens,
                <br />
                but documentation is often
                <br />
                unorganized.
              </h2>
              <p className={styles.painPointsSubtitle}>
                When inspectors ask for proof, most clinics start digging
                <br />
                through:
              </p>
              <ul className={styles.painList}>
                <li className={styles.painListItem}>
                  <span className={styles.painListDot}></span>
                  Excel spreadsheets
                </li>
                <li className={styles.painListItem}>
                  <span className={styles.painListDot}></span>
                  Email threads with certificates
                </li>
                <li className={styles.painListItem}>
                  <span className={styles.painListDot}></span>
                  Shared drive folders
                </li>
                <li className={styles.painListItem}>
                  <span className={styles.painListDot}></span>
                  Incomplete records
                </li>
                <li className={styles.painListItem}>
                  <span className={styles.painListDot}></span>
                  Missing timestamps
                </li>
              </ul>
            </div>
            <div className={styles.painPointsImageWrapper}>
              <Image
                src="/images/background.png"
                alt="Medical professionals reviewing documents"
                width={600}
                height={500}
                className={styles.painPointsImage}
              />
            </div>
          </div>
        </section>

        {/* Inspectors Section */}
        <InspectorsSection />

        {/* How It Works Section */}
        <HowItWorks />

        {/* Advantage Section */}
        <section className={styles.advantageSection}>
          <div className={styles.advantageOverlay}>
            <div className={styles.advantageContent}>
              <h2 className={styles.advantageTitle}>Built for small teams</h2>
              <p className={styles.advantageDescription}>
                Built for Small Compliance Teams. Large hospital systems have compliance
                departments.
                <br />
                Most behavioral health facilities don&apos;t. Theraptly is designed for the facility
                manager managing scheduling, billing, and incident reports,
                <br />
                without adding another operational burden. Setup takes only 15 mins.
              </p>
              <div className={styles.advantageLogo}>
                <Image
                  src="/images/logo-icon.svg"
                  alt="Theraptly Logo Icon"
                  width={32}
                  height={32}
                  className={styles.advantageLogoIcon}
                />
                <span>Theraptly</span>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Accordion Section */}
        <FeatureAccordion />

        {/* CTA Section */}
        <section className={styles.ctaSection}>
          <div className={styles.ctaContainer}>
            <div className={styles.ctaContent}>
              <h2 className={styles.ctaTitle}>Work smarter, Stay Compliant with Theraptly</h2>
              <p className={styles.ctaSubtitle}>
                Start automating tasks today and give your team more time to focus on what matters.
              </p>
              <Link href="#demo" className={styles.btnCta}>
                Request a demo
              </Link>
            </div>
            <Image
              src="/images/Logomark.svg"
              alt=""
              width={700}
              height={700}
              className={styles.ctaLogomark}
            />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
