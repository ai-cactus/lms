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
          {/* Abstract 3D Fluid Background */}
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
        <section className={styles.featuresSection} id="features">
          <div className={styles.featuresHeader}>
            <h2 className={styles.featuresTitle}>
              Built for behavioral health
              <br />
              compliance workflows.
            </h2>
            <p className={styles.featuresSubtitle}>
              Feel confident knowing your practice is fully ready for CARF and state inspections.
            </p>
          </div>

          <div className={styles.featuresGrid}>
            {/* Feature 1 */}
            <div className={styles.featureCard}>
              <div className={styles.featureIconWrapper}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M16 11V7C16 4.79086 14.2091 3 12 3C9.79086 3 8 4.79086 8 7V11M5 11H19V21H5V11Z"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M10 16L11.5 17.5L14 14.5"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className={styles.featureDivider}></div>
              <h3 className={styles.featureCardTitle}>
                Policy-Linked
                <br />
                Training
                <br />
                Documentation
              </h3>
              <p className={styles.featureCardDescription}>
                Builds every training module directly from your clinic&apos;s own policies with a
                permanent link to the source.
              </p>
            </div>

            {/* Feature 2 */}
            <div className={styles.featureCard}>
              <div className={styles.featureIconWrapper}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="12" cy="12" r="9" stroke="#101010" strokeWidth="2.5" />
                  <path
                    d="M12 8V12L15 15"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className={styles.featureDivider}></div>
              <h3 className={styles.featureCardTitle}>
                Timestamped
                <br />
                Completion Records
              </h3>
              <p className={styles.featureCardDescription}>
                Logs every completion with exact date, time, and staff name for instant surveyor
                verification.
              </p>
            </div>

            {/* Feature 3 */}
            <div className={styles.featureCard}>
              <div className={styles.featureIconWrapper}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 3L4 6V11C4 16.55 7.42 21.72 12 23C16.58 21.72 20 16.55 20 11V6L12 3Z"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z"
                    fill="#101010"
                  />
                  <path
                    d="M7.74996 17.5C7.74996 15.0147 9.65173 13 12 13C14.3483 13 16.25 15.0147 16.25 17.5"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className={styles.featureDivider}></div>
              <h3 className={styles.featureCardTitle}>
                Role-Based Staff
                <br />
                Assignments
              </h3>
              <p className={styles.featureCardDescription}>
                Assign trainings by role, department, or individual in one click with no
                spreadsheets or chasing.
              </p>
            </div>

            {/* Feature 4 */}
            <div className={styles.featureCard}>
              <div className={styles.featureIconWrapper}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M20 16V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V16M12 16V3M12 3L16 7.5M12 3L8 7.5"
                    stroke="#101010"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className={styles.featureDivider}></div>
              <h3 className={styles.featureCardTitle}>
                Exportable
                <br />
                Inspection
                <br />
                Documentation
              </h3>
              <p className={styles.featureCardDescription}>
                Generate a full auditor-ready report in seconds with policies, timestamps, and
                results, downloadable instantly.
              </p>
            </div>
          </div>

          {/* CARF Pill Badge */}
          <div className={styles.carfPill}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                fill="#1e1e1e"
              />
              <path
                d="M8 12L11 15L16 9"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Preparing facilities for CARF and state inspections.
          </div>
        </section>

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
        <section className={styles.inspectorsSection}>
          <div className={styles.inspectorsHeader}>
            <h2 className={styles.inspectorsTitle}>What Inspectors actually ask for</h2>
            <p className={styles.inspectorsSubtitle}>
              During inspections, surveyors typically request:
            </p>
          </div>

          <div className={styles.inspectorsGrid}>
            {/* Card 1 */}
            <div className={`${styles.inspectorCard} ${styles.cardSpan2}`}>
              <h3 className={styles.inspectorCardTitle}>Staffs Completion Records</h3>
              <p className={styles.inspectorCardDescription}>
                Theraptly tracks every staff member&apos;s training activity, giving you clear,
                individual completion records inspectors can easily review.
              </p>
              <div className={styles.inspectorCardImageWrapper}>
                <Image
                  src="/images/inspector-1.png"
                  alt="Staff completion records UI mockup"
                  width={400}
                  height={250}
                  className={styles.inspectorImage}
                />
              </div>
            </div>

            {/* Card 2 */}
            <div className={`${styles.inspectorCard} ${styles.cardSpan2}`}>
              <h3 className={styles.inspectorCardTitle}>Completion Timestamps</h3>
              <p className={styles.inspectorCardDescription}>
                Theraptly automatically logs precise timestamps for every training completed,
                ensuring your records are accurate and inspection-ready.
              </p>
              <div className={styles.inspectorCardImageWrapper}>
                <Image
                  src="/images/inspector-2.png"
                  alt="Completion timestamps UI mockup"
                  width={400}
                  height={250}
                  className={styles.inspectorImage}
                />
              </div>
            </div>

            {/* Card 3 */}
            <div className={`${styles.inspectorCard} ${styles.cardSpan2}`}>
              <h3 className={styles.inspectorCardTitle}>Course Results</h3>
              <p className={styles.inspectorCardDescription}>
                Theraptly captures knowledge check outcomes for each course, showing that staff not
                only completed training but understood the material.
              </p>
              <div className={styles.inspectorCardImageWrapper}>
                <Image
                  src="/images/inspector-3.png"
                  alt="Course results line graph mockup"
                  width={400}
                  height={250}
                  className={styles.inspectorImage}
                />
              </div>
            </div>

            {/* Card 4 */}
            <div className={`${styles.inspectorCard} ${styles.cardSpan3}`}>
              <h3 className={styles.inspectorCardTitle}>Source Policy the Training Was Based On</h3>
              <p className={styles.inspectorCardDescription}>
                Theraptly links every training module back to its original policy, so inspectors can
                clearly see exactly what each course is based on, without any confusion or gaps.
              </p>
              <div className={styles.inspectorCardImageWrapper}>
                <Image
                  src="/images/inspector-4.png"
                  alt="Policy links diagram mockup"
                  width={600}
                  height={300}
                  className={styles.inspectorImage}
                />
              </div>
            </div>

            {/* Card 5 */}
            <div className={`${styles.inspectorCard} ${styles.cardSpan3}`}>
              <h3 className={styles.inspectorCardTitle}>
                Exportable Documentation They Can Review On-Site
              </h3>
              <p className={styles.inspectorCardDescription}>
                Theraptly compiles all training data into clean, exportable reports, making it easy
                to present documentation during inspections.
              </p>
              <div className={styles.inspectorCardImageWrapper}>
                <Image
                  src="/images/inspector-5.png"
                  alt="Exportable documentation modal mockup"
                  width={600}
                  height={300}
                  className={styles.inspectorImage}
                />
              </div>
            </div>
          </div>

          <div className={styles.inspectorsActions}>
            <Link href="/signup" className={styles.btnPrimary}>
              Start for free &rarr;
            </Link>
            <Link href="#demo" className={styles.btnSecondary}>
              Request Demo
            </Link>
          </div>
        </section>

        {/* How It Works Section */}
        <section className={styles.howItWorksSection}>
          <div className={styles.howItWorksContainer}>
            {/* Header Column */}
            <div className={styles.howItWorksHeader}>
              <h2 className={styles.howItWorksTitle}>How it works</h2>
              <p className={styles.howItWorksSubtitle}>Just follow these easy steps</p>
            </div>

            {/* Step 1 */}
            <div className={styles.stepCard}>
              <div className={styles.stepImageWrapper}>
                <Image
                  src="/images/carousel-a.png"
                  alt="Upload Training Documents Screen"
                  width={300}
                  height={400}
                  className={styles.stepImage}
                />
              </div>
              <div className={styles.stepIndicator}>
                <span className={styles.stepNumber}>1</span>
                <div className={styles.stepLine}></div>
              </div>
              <h3 className={styles.stepTitle}>Upload Your Policy</h3>
              <p className={styles.stepDescription}>
                Upload your policy or procedure, and Theraptly converts it into a ready-to-use
                training module with lessons and quizzes
              </p>
            </div>

            {/* Step 2 */}
            <div className={styles.stepCard}>
              <div className={styles.stepImageWrapper}>
                <Image
                  src="/images/carousel-b.png"
                  alt="Training Principle Overview Screen"
                  width={300}
                  height={400}
                  className={styles.stepImage}
                />
              </div>
              <div className={styles.stepIndicator}>
                <span className={styles.stepNumber}>2</span>
                <div className={styles.stepLine}></div>
              </div>
              <h3 className={styles.stepTitle}>Assign & Train Your Team</h3>
              <p className={styles.stepDescription}>
                Assign courses to staff based on roles, track progress, and ensure everyone
                completes required training on time.
              </p>
            </div>

            {/* Step 3 */}
            <div className={styles.stepCard}>
              <div className={styles.stepImageWrapper}>
                <Image
                  src="/images/carousel-c.png"
                  alt="Assigned Courses Dashboard Screen"
                  width={300}
                  height={400}
                  className={styles.stepImage}
                />
              </div>
              <div className={styles.stepIndicator}>
                <span className={styles.stepNumber}>3</span>
                <div className={styles.stepLine}></div>
              </div>
              <h3 className={styles.stepTitle}>Track Performance & Be Audit-ready</h3>
              <p className={styles.stepDescription}>
                Get real-time insights on completion rates, quiz results, and CARF alignment—all in
                one dashboard.
              </p>
            </div>
          </div>
        </section>

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
