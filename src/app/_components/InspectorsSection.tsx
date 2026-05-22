import React from 'react';
import Image from 'next/image';
import styles from './InspectorsSection.module.css';
import InspectorsActions from './InspectorsActions';

interface InspectorsSectionProps {
  showActions?: boolean;
}

export default function InspectorsSection({ showActions = true }: InspectorsSectionProps) {
  return (
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
              src="/images/inspector-01.jpg"
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
            Theraptly automatically logs precise timestamps for every training completed, ensuring
            your records are accurate and inspection-ready.
          </p>
          <div className={styles.inspectorCardImageWrapper}>
            <Image
              src="/images/inspector-02.jpg"
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
            Theraptly captures knowledge check outcomes for each course, showing that staff not only
            completed training but understood the material.
          </p>
          <div className={styles.inspectorCardImageWrapper}>
            <Image
              src="/images/inspector-03.jpg"
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
              src="/images/inspector-04.jpg"
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
            Theraptly compiles all training data into clean, exportable reports, making it easy to
            present documentation during inspections.
          </p>
          <div className={styles.inspectorCardImageWrapper}>
            <Image
              src="/images/inspector-05.jpg"
              alt="Exportable documentation modal mockup"
              width={600}
              height={300}
              className={styles.inspectorImage}
            />
          </div>
        </div>
      </div>

      {showActions && <InspectorsActions />}
    </section>
  );
}
