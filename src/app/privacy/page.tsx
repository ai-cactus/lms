import React from 'react';
import { TriangleAlert } from 'lucide-react';

const sectionClass = 'mb-10';
const sectionTitleClass =
  'mb-4 border-b border-border-light pb-2 text-2xl font-semibold text-foreground';
const subSectionTitleClass = 'mb-3 mt-6 text-xl font-semibold text-foreground';
const textClass = 'mb-4 text-base leading-[1.7] text-text-secondary';
const listClass = 'mb-4 list-disc pl-6 text-text-secondary';
const listItemClass = 'mb-2 leading-relaxed';

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[800px] px-4 py-16">
      <h1 className="mb-8 text-center text-[2.5rem] font-bold text-foreground">Privacy Policy</h1>

      <div className="mb-10 rounded-[10px] border border-border bg-background-secondary p-6 text-lg leading-[1.7] text-text-secondary">
        <p>
          <strong>Effective Date:</strong> March 2, 2026
        </p>
        <p>
          <strong>Company:</strong> Internova Technologies
        </p>
      </div>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>1. Overview</h2>
        <p className={textClass}>
          Internova Technologies (“Company,” “we,” “us,” or “our”) provides the Internova LMS
          platform (“Platform”). This Privacy Policy describes how we collect, use, disclose, and
          safeguard information in connection with the Platform. This Policy applies to:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Organizational customers</li>
          <li className={listItemClass}>Authorized users of customer accounts</li>
          <li className={listItemClass}>Website visitors</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <div className="my-6 rounded-r-[10px] border-l-4 border-error bg-[#fef2f2] px-6 py-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-[#991b1b]">
            <TriangleAlert className="size-5" aria-hidden="true" />
            2. Important Notice Regarding Protected Health Information
          </div>
          <p className="m-0 text-[0.95rem] text-[#b91c1c]">
            The Platform is not designed to receive, store, process, or transmit Protected Health
            Information (“PHI”) as defined under HIPAA or similar laws. Users must not upload PHI to
            the Platform. Internova Technologies does not act as a Business Associate for this
            product and does not enter into Business Associate Agreements. If PHI is submitted in
            violation of our Terms of Service, such submission is unauthorized and may be deleted.
          </p>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>3. Definitions</h2>
        <p className={textClass}>For purposes of this Policy:</p>
        <ul className={listClass}>
          <li className={listItemClass}>
            <strong>“Customer”</strong> means the organization subscribing to the Platform.
          </li>
          <li className={listItemClass}>
            <strong>“User”</strong> means an individual authorized by a Customer to access the
            Platform.
          </li>
          <li className={listItemClass}>
            <strong>“Customer Data”</strong> means information uploaded to the Platform by or on
            behalf of a Customer.
          </li>
          <li className={listItemClass}>
            <strong>“Personal Information”</strong> means information that identifies or reasonably
            relates to an identifiable individual.
          </li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>4. Roles and Data Processing Relationship</h2>
        <p className={textClass}>
          Internova LMS is provided to organizations. The Customer acts as the data controller (or
          business under applicable U.S. state law). Internova Technologies acts as a service
          provider / data processor processing Customer Data solely on the Customer’s behalf and
          according to the Customer’s instructions. We do not determine the purposes for which
          Customer Data is processed, except as necessary to provide and maintain the Platform.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>5. Information We Collect</h2>

        <h3 className={subSectionTitleClass}>5.1 Account and Business Information</h3>
        <p className={textClass}>We may collect:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Organization name</li>
          <li className={listItemClass}>Administrator name</li>
          <li className={listItemClass}>Business email address</li>
          <li className={listItemClass}>Billing information</li>
          <li className={listItemClass}>Account credentials</li>
        </ul>

        <h3 className={subSectionTitleClass}>5.2 User Information</h3>
        <p className={textClass}>We may process:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Name</li>
          <li className={listItemClass}>Work email address</li>
          <li className={listItemClass}>Username</li>
          <li className={listItemClass}>Training progress data</li>
          <li className={listItemClass}>Assessment results</li>
          <li className={listItemClass}>Certification records</li>
        </ul>
        <p className={textClass}>
          <strong>We do not collect medical records or patient treatment data.</strong>
        </p>

        <h3 className={subSectionTitleClass}>5.3 Customer-Uploaded Content</h3>
        <p className={textClass}>
          Customers may upload Policies, Training materials, Documentation, and Internal compliance
          content.
          <strong>
            Customers are responsible for ensuring such content does not contain PHI or unlawful
            data.
          </strong>
        </p>

        <h3 className={subSectionTitleClass}>5.4 Technical and Usage Information</h3>
        <p className={textClass}>We may automatically collect:</p>
        <ul className={listClass}>
          <li className={listItemClass}>IP address</li>
          <li className={listItemClass}>Device type</li>
          <li className={listItemClass}>Browser type</li>
          <li className={listItemClass}>Log data</li>
          <li className={listItemClass}>Access timestamps</li>
          <li className={listItemClass}>Usage metrics</li>
        </ul>
        <p className={textClass}>
          This information is used for security, performance monitoring, and system improvement.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>6. How We Use Information</h2>
        <p className={textClass}>We process information to:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Provide and operate the Platform</li>
          <li className={listItemClass}>Authenticate users</li>
          <li className={listItemClass}>Deliver training functionality</li>
          <li className={listItemClass}>Generate reports</li>
          <li className={listItemClass}>Process billing</li>
          <li className={listItemClass}>Monitor system security</li>
          <li className={listItemClass}>Detect misuse</li>
          <li className={listItemClass}>Comply with legal obligations</li>
        </ul>
        <p className={textClass}>
          <strong>We do not sell Personal Information.</strong> We do not share Personal Information
          for cross-context behavioral advertising.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>7. Data Minimization and Purpose Limitation</h2>
        <p className={textClass}>
          We limit collection and processing of Personal Information to what is reasonably necessary
          to:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Deliver contracted services</li>
          <li className={listItemClass}>Maintain system security</li>
          <li className={listItemClass}>Fulfill legal obligations</li>
        </ul>
        <p className={textClass}>We do not use Customer Data for unrelated commercial purposes.</p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>8. Disclosure of Information</h2>

        <h3 className={subSectionTitleClass}>8.1 Service Providers (Subprocessors)</h3>
        <p className={textClass}>
          We engage third-party service providers for Cloud hosting, Infrastructure services,
          Payment processing, and Security monitoring.
        </p>
        <p className={textClass}>
          These providers are contractually obligated to safeguard Personal Information and process
          it only for authorized purposes. A list of subprocessors may be provided upon reasonable
          request.
        </p>

        <h3 className={subSectionTitleClass}>8.2 Legal Obligations</h3>
        <p className={textClass}>
          We may disclose information when required by Law, Court order, Subpoena, or Government
          authority.
        </p>

        <h3 className={subSectionTitleClass}>8.3 Business Transfers</h3>
        <p className={textClass}>
          Customer Data may be transferred as part of a Merger, Acquisition, Asset sale, or
          Corporate restructuring.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>9. Data Security</h2>
        <p className={textClass}>
          We implement administrative, technical, and organizational safeguards designed to protect
          Personal Information, including:
        </p>
        <ul className={listClass}>
          <li className={listItemClass}>Access controls</li>
          <li className={listItemClass}>Logical segregation of customer environments</li>
          <li className={listItemClass}>Encryption in transit</li>
          <li className={listItemClass}>Infrastructure-level security monitoring</li>
        </ul>
        <p className={textClass}>
          No method of transmission or storage is completely secure. We do not guarantee absolute
          security.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>10. Security Incident Notification</h2>
        <p className={textClass}>
          In the event of a confirmed security incident involving unauthorized access to Customer
          Data, we will notify the affected Customer without undue delay after confirmation of the
          incident.
        </p>
        <p className={textClass}>Notification will include:</p>
        <ul className={listClass}>
          <li className={listItemClass}>A description of the nature of the incident</li>
          <li className={listItemClass}>The categories of data involved (if known)</li>
          <li className={listItemClass}>Steps taken to mitigate the incident</li>
        </ul>
        <p className={textClass}>
          Customers remain responsible for determining any regulatory notification obligations.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>11. Data Retention</h2>
        <p className={textClass}>
          We retain Customer Data for the duration of the subscription, as required to fulfill
          contractual obligations, or as required by law.
        </p>
        <p className={textClass}>Upon termination:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Customers may export data within thirty (30) days.</li>
          <li className={listItemClass}>After that period, data may be permanently deleted.</li>
        </ul>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>12. Customer Control and Data Subject Requests</h2>
        <p className={textClass}>Because the Platform is provided to organizations:</p>
        <ul className={listClass}>
          <li className={listItemClass}>Customers control uploaded data.</li>
          <li className={listItemClass}>
            Individual Users should contact their organization for data access, correction, or
            deletion requests.
          </li>
        </ul>
        <p className={textClass}>
          We will assist Customers in responding to verified requests where required by law.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>13. State Privacy Rights (U.S.)</h2>
        <p className={textClass}>
          Where applicable state privacy laws apply, individuals may have rights including Access,
          Correction, Deletion, and Data portability. Because we act as a service provider, such
          requests should generally be directed to the Customer organization.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>14. Children’s Privacy</h2>
        <p className={textClass}>
          The Platform is not intended for individuals under 18. We do not knowingly collect
          information from minors.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>15. International Data Transfers</h2>
        <p className={textClass}>
          The Platform is intended for use within the United States. If accessed from outside the
          United States, information may be processed in the United States.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className={sectionTitleClass}>16. Changes to This Policy</h2>
        <p className={textClass}>
          We may update this Privacy Policy periodically. The updated version will include a revised
          effective date. Continued use of the Platform constitutes acceptance of the revised
          Policy.
        </p>
      </section>

      <section className="mt-12 rounded-[10px] bg-[#eef2ff] p-8 [&_p]:mb-2 [&_p]:text-text-secondary [&>strong]:mb-4 [&>strong]:block [&>strong]:text-lg [&>strong]:text-primary">
        <h2 className={sectionTitleClass}>17. Contact Information</h2>
        <strong>Internova Technologies</strong>
        <p>431 Woodcrest Dr SE</p>
        <p>Washington, DC 20032</p>
        <p>
          <a href="mailto:internovatechnologies@gmail.com" className="text-primary hover:underline">
            internovatechnologies@gmail.com
          </a>
        </p>
      </section>
    </div>
  );
}
