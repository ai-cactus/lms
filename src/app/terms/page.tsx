import React from 'react';
import { TriangleAlert } from 'lucide-react';

const sectionClass = 'mb-10';
const sectionTitleClass =
  'mb-4 border-b border-border-light pb-2 text-2xl font-semibold text-foreground';
const textClass = 'mb-4 text-base leading-[1.7] text-text-secondary';
const listClass = 'mb-4 list-disc pl-6 text-text-secondary';
const listItemClass = 'mb-2 leading-relaxed';
const alertSubTitleClass = 'mb-3 mt-6 text-xl font-semibold text-[#991B1B]';
const alertTextClass = 'mb-4 m-0 text-[0.95rem] text-[#b91c1c]';

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[800px] px-4 py-16">
      <h1 className="mb-8 text-center text-[2.5rem] font-bold text-foreground">Terms of Service</h1>

      <div className="mb-10 rounded-[10px] border border-border bg-background-secondary p-6 text-lg leading-[1.7] text-text-secondary">
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

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>1. Agreement and Acceptance</h2>
        <p className={textClass}>
          These Terms of Service (“Terms”) govern access to and use of the Internova LMS platform
          (“Platform”) provided by Internova Technologies (“Company,” “we,” “us”). If you access or
          use the Platform on behalf of an organization (“Customer”), you represent and warrant that
          you have authority to bind that organization.
          <strong>If you do not agree to these Terms, you may not use the Platform.</strong>
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>2. Scope of Services</h2>
        <p className={textClass}>
          The Platform is a cloud-based learning management system that enables organizations to:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Deliver training materials</li>
          <li className={listItemClass}>Administer assessments</li>
          <li className={listItemClass}>Track completion and certifications</li>
          <li className={listItemClass}>Generate reports</li>
          <li className={listItemClass}>Manage internal documentation</li>
        </ul>
        <p className={textClass}>
          The Platform is provided as software-as-a-service. Nothing in these Terms creates an
          obligation to deliver services beyond those expressly described in a written order or
          subscription agreement.
        </p>
      </section>

      <section className={sectionClass}>
        <div className="my-6 rounded-r-[10px] border-l-4 border-error bg-[#fef2f2] px-6 py-4">
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-[#991b1b]">
            <TriangleAlert className="size-5" aria-hidden="true" />
            3. Absolute Prohibition on Protected Health Information
          </h2>

          <h3 className={alertSubTitleClass}>3.1 No PHI Permitted</h3>
          <p className={alertTextClass}>
            The Platform is not designed to receive, store, process, or transmit Protected Health
            Information (“PHI”) as defined under HIPAA or similar laws. Customer shall not upload,
            transmit, store, or otherwise process PHI through the Platform.
            <strong>This prohibition is material to this Agreement.</strong>
          </p>

          <h3 className={alertSubTitleClass}>3.2 No Business Associate Relationship</h3>
          <p className={alertTextClass}>
            Internova Technologies is not acting as a Business Associate under HIPAA in connection
            with the Platform. No Business Associate Agreement is offered or implied.
          </p>

          <h3 className={alertSubTitleClass}>3.3 Remedies for PHI Upload</h3>
          <p className={alertTextClass}>If Customer uploads PHI in violation of these Terms:</p>
          <ul className="mb-4 list-disc pl-6 text-[#B91C1C]">
            <li className={listItemClass}>
              Company may immediately suspend access without notice.
            </li>
            <li className={listItemClass}>
              Company may permanently delete such data without liability.
            </li>
            <li className={listItemClass}>
              Customer shall bear sole responsibility for all regulatory, legal, and financial
              consequences.
            </li>
            <li className={listItemClass}>
              Customer shall defend, indemnify, and hold harmless Company from any claim,
              investigation, penalty, or damage arising from the upload of PHI.
            </li>
          </ul>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>4. Customer Responsibilities</h2>
        <p className={textClass}>Customer shall:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Maintain accurate account information</li>
          <li className={listItemClass}>Safeguard credentials</li>
          <li className={listItemClass}>Restrict access to authorized personnel</li>
          <li className={listItemClass}>Ensure all content complies with applicable law</li>
        </ul>
        <p className={textClass}>
          Customer is responsible for all activity occurring under its accounts.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>5. Acceptable Use</h2>
        <p className={textClass}>Customer shall not:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Upload PHI</li>
          <li className={listItemClass}>Use the Platform for unlawful purposes</li>
          <li className={listItemClass}>Circumvent access controls</li>
          <li className={listItemClass}>Interfere with system integrity</li>
          <li className={listItemClass}>Attempt to reverse engineer or copy the Platform</li>
        </ul>
        <p className={textClass}>Company may suspend or terminate access for violations.</p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>6. Customer Content</h2>
        <p className={textClass}>Customer retains ownership of content uploaded to the Platform.</p>
        <p className={textClass}>
          Customer grants Company a limited, non-exclusive license to host and process such content
          solely to provide the services.
        </p>
        <p className={textClass}>Customer represents and warrants that:</p>
        <ul className={listClass}>
          <li className={listItemClass}>It has all rights necessary to upload the content.</li>
          <li className={listItemClass}>The content does not contain PHI.</li>
          <li className={listItemClass}>The content complies with law.</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>7. Security and Disclaimer of Warranties</h2>
        <p className={textClass}>
          <strong>The Platform is provided “AS IS” and “AS AVAILABLE.”</strong>
        </p>
        <p className={textClass}>
          Company disclaims all warranties, express or implied, including:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Merchantability</li>
          <li className={listItemClass}>Fitness for a particular purpose</li>
          <li className={listItemClass}>Non-infringement</li>
          <li className={listItemClass}>Regulatory compliance</li>
        </ul>
        <p className={textClass}>Company does not guarantee:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Continuous availability</li>
          <li className={listItemClass}>Error-free operation</li>
          <li className={listItemClass}>Compliance outcomes</li>
        </ul>
        <p className={textClass}>
          Customer is solely responsible for determining regulatory suitability.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>8. Fees and Payment</h2>
        <p className={textClass}>
          Fees are due as specified in the applicable order. Failure to pay may result in
          suspension. All fees are non-refundable unless otherwise agreed in writing.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>9. Data Retention and Deletion</h2>
        <p className={textClass}>Upon termination:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Customer may export data within thirty (30) days.</li>
          <li className={listItemClass}>
            After that period, Company may permanently delete all data.
          </li>
        </ul>
        <p className={textClass}>Company has no obligation to retain data beyond that period.</p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>10. Limitation of Liability</h2>
        <p className={textClass}>
          To the maximum extent permitted by law, Company shall not be liable for:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Indirect damages</li>
          <li className={listItemClass}>Consequential damages</li>
          <li className={listItemClass}>Special damages</li>
          <li className={listItemClass}>Lost profits</li>
          <li className={listItemClass}>Lost revenue</li>
          <li className={listItemClass}>Business interruption</li>
          <li className={listItemClass}>Regulatory fines or penalties</li>
          <li className={listItemClass}>Data loss</li>
        </ul>
        <p className={textClass}>
          <strong>
            Company’s total cumulative liability shall not exceed the total fees paid by Customer in
            the twelve (12) months preceding the claim.
          </strong>
          This limitation applies regardless of legal theory.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>11. Indemnification</h2>
        <p className={textClass}>
          Customer shall defend, indemnify, and hold harmless Company from all claims, liabilities,
          damages, costs, and expenses arising from:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Violation of these Terms</li>
          <li className={listItemClass}>Upload of PHI</li>
          <li className={listItemClass}>Regulatory non-compliance</li>
          <li className={listItemClass}>Customer content</li>
          <li className={listItemClass}>Customer misuse of the Platform</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>12. Confidentiality</h2>
        <p className={textClass}>
          Each party agrees to protect the other’s non-public business information with reasonable
          care and not disclose it except as required by law.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>13. Force Majeure</h2>
        <p className={textClass}>
          Company shall not be liable for failure or delay resulting from causes beyond reasonable
          control, including:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Acts of God</li>
          <li className={listItemClass}>Natural disasters</li>
          <li className={listItemClass}>Cyberattacks</li>
          <li className={listItemClass}>Government actions</li>
          <li className={listItemClass}>Infrastructure failures</li>
          <li className={listItemClass}>War or terrorism</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>14. Assignment</h2>
        <p className={textClass}>
          Customer may not assign these Terms without Company’s prior written consent. Company may
          assign these Terms in connection with merger, acquisition, or asset sale.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>15. Governing Law and Venue</h2>
        <p className={textClass}>
          These Terms are governed by the laws of the State of Delaware, without regard to
          conflict-of-law principles. Any dispute shall be resolved exclusively in the state or
          federal courts located in Delaware. The parties waive any objection to venue.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>16. Binding Arbitration; Class Action Waiver</h2>
        <p className={textClass}>
          At Company’s election, any dispute may be resolved by binding arbitration under the rules
          of the American Arbitration Association.
        </p>
        <p className={textClass}>Customer agrees:</p>
        <ul className={listClass}>
          <li className={listItemClass}>No class actions</li>
          <li className={listItemClass}>No collective proceedings</li>
          <li className={listItemClass}>No representative claims</li>
        </ul>
        <p className={textClass}>
          <strong>Each party waives the right to trial by jury.</strong>
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>17. Entire Agreement</h2>
        <p className={textClass}>
          These Terms constitute the entire agreement between the parties and supersede prior
          agreements.
        </p>
      </section>
    </div>
  );
}
