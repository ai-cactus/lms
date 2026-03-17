import React from 'react';
import styles from './terms.module.css';

export default function TermsPage() {
  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Terms of Service</h1>

      <div className={styles.intro}>
        <p>
          <strong>Effective Date:</strong> March 2, 2026
        </p>
        <p>
          <strong>Company:</strong> Internova Technologies
        </p>
        <p>
          <strong>Address:</strong> 431 Woodcrest Dr SE, Washington, DC 20032
        </p>
        <p>
          <strong>Email:</strong>{' '}
          <a href="mailto:internovatechnologies@gmail.com" className="text-primary hover:underline">
            internovatechnologies@gmail.com
          </a>
        </p>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>1. Agreement and Acceptance</h2>
        <p className={styles.text}>
          These Terms of Service (“Terms”) govern access to and use of the Internova LMS platform
          (“Platform”) provided by Internova Technologies (“Company,” “we,” “us”). If you access or
          use the Platform on behalf of an organization (“Customer”), you represent and warrant that
          you have authority to bind that organization.
          <strong>If you do not agree to these Terms, you may not use the Platform.</strong>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>2. Scope of Services</h2>
        <p className={styles.text}>
          The Platform is a cloud-based learning management system that enables organizations to:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Deliver training materials</li>
          <li className={styles.listItem}>Administer assessments</li>
          <li className={styles.listItem}>Track completion and certifications</li>
          <li className={styles.listItem}>Generate reports</li>
          <li className={styles.listItem}>Manage internal documentation</li>
        </ul>
        <p className={styles.text}>
          The Platform is provided as software-as-a-service. Nothing in these Terms creates an
          obligation to deliver services beyond those expressly described in a written order or
          subscription agreement.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.alert}>
          <h2 className={styles.alertTitle}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            3. Absolute Prohibition on Protected Health Information
          </h2>

          <h3 className={styles.subSectionTitle} style={{ color: '#991B1B' }}>
            3.1 No PHI Permitted
          </h3>
          <p className={styles.alertText}>
            The Platform is not designed to receive, store, process, or transmit Protected Health
            Information (“PHI”) as defined under HIPAA or similar laws. Customer shall not upload,
            transmit, store, or otherwise process PHI through the Platform.
            <strong>This prohibition is material to this Agreement.</strong>
          </p>

          <h3 className={styles.subSectionTitle} style={{ color: '#991B1B' }}>
            3.2 No Business Associate Relationship
          </h3>
          <p className={styles.alertText}>
            Internova Technologies is not acting as a Business Associate under HIPAA in connection
            with the Platform. No Business Associate Agreement is offered or implied.
          </p>

          <h3 className={styles.subSectionTitle} style={{ color: '#991B1B' }}>
            3.3 Remedies for PHI Upload
          </h3>
          <p className={styles.alertText}>If Customer uploads PHI in violation of these Terms:</p>
          <ul className={styles.list} style={{ color: '#B91C1C' }}>
            <li className={styles.listItem}>
              Company may immediately suspend access without notice.
            </li>
            <li className={styles.listItem}>
              Company may permanently delete such data without liability.
            </li>
            <li className={styles.listItem}>
              Customer shall bear sole responsibility for all regulatory, legal, and financial
              consequences.
            </li>
            <li className={styles.listItem}>
              Customer shall defend, indemnify, and hold harmless Company from any claim,
              investigation, penalty, or damage arising from the upload of PHI.
            </li>
          </ul>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>4. Customer Responsibilities</h2>
        <p className={styles.text}>Customer shall:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Maintain accurate account information</li>
          <li className={styles.listItem}>Safeguard credentials</li>
          <li className={styles.listItem}>Restrict access to authorized personnel</li>
          <li className={styles.listItem}>Ensure all content complies with applicable law</li>
        </ul>
        <p className={styles.text}>
          Customer is responsible for all activity occurring under its accounts.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>5. Acceptable Use</h2>
        <p className={styles.text}>Customer shall not:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Upload PHI</li>
          <li className={styles.listItem}>Use the Platform for unlawful purposes</li>
          <li className={styles.listItem}>Circumvent access controls</li>
          <li className={styles.listItem}>Interfere with system integrity</li>
          <li className={styles.listItem}>Attempt to reverse engineer or copy the Platform</li>
        </ul>
        <p className={styles.text}>Company may suspend or terminate access for violations.</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>6. Customer Content</h2>
        <p className={styles.text}>
          Customer retains ownership of content uploaded to the Platform.
        </p>
        <p className={styles.text}>
          Customer grants Company a limited, non-exclusive license to host and process such content
          solely to provide the services.
        </p>
        <p className={styles.text}>Customer represents and warrants that:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>It has all rights necessary to upload the content.</li>
          <li className={styles.listItem}>The content does not contain PHI.</li>
          <li className={styles.listItem}>The content complies with law.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>7. Security and Disclaimer of Warranties</h2>
        <p className={styles.text}>
          <strong>The Platform is provided “AS IS” and “AS AVAILABLE.”</strong>
        </p>
        <p className={styles.text}>
          Company disclaims all warranties, express or implied, including:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Merchantability</li>
          <li className={styles.listItem}>Fitness for a particular purpose</li>
          <li className={styles.listItem}>Non-infringement</li>
          <li className={styles.listItem}>Regulatory compliance</li>
        </ul>
        <p className={styles.text}>Company does not guarantee:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Continuous availability</li>
          <li className={styles.listItem}>Error-free operation</li>
          <li className={styles.listItem}>Compliance outcomes</li>
        </ul>
        <p className={styles.text}>
          Customer is solely responsible for determining regulatory suitability.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>8. Fees and Payment</h2>
        <p className={styles.text}>
          Fees are due as specified in the applicable order. Failure to pay may result in
          suspension. All fees are non-refundable unless otherwise agreed in writing.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>9. Data Retention and Deletion</h2>
        <p className={styles.text}>Upon termination:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Customer may export data within thirty (30) days.</li>
          <li className={styles.listItem}>
            After that period, Company may permanently delete all data.
          </li>
        </ul>
        <p className={styles.text}>Company has no obligation to retain data beyond that period.</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>10. Limitation of Liability</h2>
        <p className={styles.text}>
          To the maximum extent permitted by law, Company shall not be liable for:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Indirect damages</li>
          <li className={styles.listItem}>Consequential damages</li>
          <li className={styles.listItem}>Special damages</li>
          <li className={styles.listItem}>Lost profits</li>
          <li className={styles.listItem}>Lost revenue</li>
          <li className={styles.listItem}>Business interruption</li>
          <li className={styles.listItem}>Regulatory fines or penalties</li>
          <li className={styles.listItem}>Data loss</li>
        </ul>
        <p className={styles.text}>
          <strong>
            Company’s total cumulative liability shall not exceed the total fees paid by Customer in
            the twelve (12) months preceding the claim.
          </strong>
          This limitation applies regardless of legal theory.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>11. Indemnification</h2>
        <p className={styles.text}>
          Customer shall defend, indemnify, and hold harmless Company from all claims, liabilities,
          damages, costs, and expenses arising from:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Violation of these Terms</li>
          <li className={styles.listItem}>Upload of PHI</li>
          <li className={styles.listItem}>Regulatory non-compliance</li>
          <li className={styles.listItem}>Customer content</li>
          <li className={styles.listItem}>Customer misuse of the Platform</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>12. Confidentiality</h2>
        <p className={styles.text}>
          Each party agrees to protect the other’s non-public business information with reasonable
          care and not disclose it except as required by law.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>13. Force Majeure</h2>
        <p className={styles.text}>
          Company shall not be liable for failure or delay resulting from causes beyond reasonable
          control, including:
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>Acts of God</li>
          <li className={styles.listItem}>Natural disasters</li>
          <li className={styles.listItem}>Cyberattacks</li>
          <li className={styles.listItem}>Government actions</li>
          <li className={styles.listItem}>Infrastructure failures</li>
          <li className={styles.listItem}>War or terrorism</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>14. Assignment</h2>
        <p className={styles.text}>
          Customer may not assign these Terms without Company’s prior written consent. Company may
          assign these Terms in connection with merger, acquisition, or asset sale.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>15. Governing Law and Venue</h2>
        <p className={styles.text}>
          These Terms are governed by the laws of the State of Delaware, without regard to
          conflict-of-law principles. Any dispute shall be resolved exclusively in the state or
          federal courts located in Delaware. The parties waive any objection to venue.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>16. Binding Arbitration; Class Action Waiver</h2>
        <p className={styles.text}>
          At Company’s election, any dispute may be resolved by binding arbitration under the rules
          of the American Arbitration Association.
        </p>
        <p className={styles.text}>Customer agrees:</p>
        <ul className={styles.list}>
          <li className={styles.listItem}>No class actions</li>
          <li className={styles.listItem}>No collective proceedings</li>
          <li className={styles.listItem}>No representative claims</li>
        </ul>
        <p className={styles.text}>
          <strong>Each party waives the right to trial by jury.</strong>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>17. Entire Agreement</h2>
        <p className={styles.text}>
          These Terms constitute the entire agreement between the parties and supersede prior
          agreements.
        </p>
      </section>
    </div>
  );
}
