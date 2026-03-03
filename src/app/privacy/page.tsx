import React from 'react';
import styles from './privacy.module.css';

export default function PrivacyPage() {
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>Privacy Policy</h1>

            <div className={styles.intro}>
                <p><strong>Effective Date:</strong> March 2, 2026</p>
                <p><strong>Company:</strong> Internova Technologies</p>
            </div>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>1. Overview</h2>
                <p className={styles.text}>
                    Internova Technologies (“Company,” “we,” “us,” or “our”) provides the Internova LMS platform (“Platform”).
                    This Privacy Policy describes how we collect, use, disclose, and safeguard information in connection with the Platform.
                    This Policy applies to:
                </p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Organizational customers</li>
                    <li className={styles.listItem}>Authorized users of customer accounts</li>
                    <li className={styles.listItem}>Website visitors</li>
                </ul>
            </section>

            <section className={styles.section}>
                <div className={styles.alert}>
                    <div className={styles.alertTitle}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                            <path d="M12 9v4" />
                            <path d="M12 17h.01" />
                        </svg>
                        2. Important Notice Regarding Protected Health Information
                    </div>
                    <p className={styles.alertText}>
                        The Platform is not designed to receive, store, process, or transmit Protected Health Information (“PHI”) as defined under HIPAA or similar laws.
                        Users must not upload PHI to the Platform.
                        Internova Technologies does not act as a Business Associate for this product and does not enter into Business Associate Agreements.
                        If PHI is submitted in violation of our Terms of Service, such submission is unauthorized and may be deleted.
                    </p>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>3. Definitions</h2>
                <p className={styles.text}>For purposes of this Policy:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}><strong>“Customer”</strong> means the organization subscribing to the Platform.</li>
                    <li className={styles.listItem}><strong>“User”</strong> means an individual authorized by a Customer to access the Platform.</li>
                    <li className={styles.listItem}><strong>“Customer Data”</strong> means information uploaded to the Platform by or on behalf of a Customer.</li>
                    <li className={styles.listItem}><strong>“Personal Information”</strong> means information that identifies or reasonably relates to an identifiable individual.</li>
                </ul>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>4. Roles and Data Processing Relationship</h2>
                <p className={styles.text}>
                    Internova LMS is provided to organizations. The Customer acts as the data controller (or business under applicable U.S. state law).
                    Internova Technologies acts as a service provider / data processor processing Customer Data solely on the Customer’s behalf and according to the Customer’s instructions.
                    We do not determine the purposes for which Customer Data is processed, except as necessary to provide and maintain the Platform.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>5. Information We Collect</h2>

                <h3 className={styles.subSectionTitle}>5.1 Account and Business Information</h3>
                <p className={styles.text}>We may collect:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Organization name</li>
                    <li className={styles.listItem}>Administrator name</li>
                    <li className={styles.listItem}>Business email address</li>
                    <li className={styles.listItem}>Billing information</li>
                    <li className={styles.listItem}>Account credentials</li>
                </ul>

                <h3 className={styles.subSectionTitle}>5.2 User Information</h3>
                <p className={styles.text}>We may process:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Name</li>
                    <li className={styles.listItem}>Work email address</li>
                    <li className={styles.listItem}>Username</li>
                    <li className={styles.listItem}>Training progress data</li>
                    <li className={styles.listItem}>Assessment results</li>
                    <li className={styles.listItem}>Certification records</li>
                </ul>
                <p className={styles.text}><strong>We do not collect medical records or patient treatment data.</strong></p>

                <h3 className={styles.subSectionTitle}>5.3 Customer-Uploaded Content</h3>
                <p className={styles.text}>
                    Customers may upload Policies, Training materials, Documentation, and Internal compliance content.
                    <strong>Customers are responsible for ensuring such content does not contain PHI or unlawful data.</strong>
                </p>

                <h3 className={styles.subSectionTitle}>5.4 Technical and Usage Information</h3>
                <p className={styles.text}>We may automatically collect:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>IP address</li>
                    <li className={styles.listItem}>Device type</li>
                    <li className={styles.listItem}>Browser type</li>
                    <li className={styles.listItem}>Log data</li>
                    <li className={styles.listItem}>Access timestamps</li>
                    <li className={styles.listItem}>Usage metrics</li>
                </ul>
                <p className={styles.text}>This information is used for security, performance monitoring, and system improvement.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>6. How We Use Information</h2>
                <p className={styles.text}>We process information to:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Provide and operate the Platform</li>
                    <li className={styles.listItem}>Authenticate users</li>
                    <li className={styles.listItem}>Deliver training functionality</li>
                    <li className={styles.listItem}>Generate reports</li>
                    <li className={styles.listItem}>Process billing</li>
                    <li className={styles.listItem}>Monitor system security</li>
                    <li className={styles.listItem}>Detect misuse</li>
                    <li className={styles.listItem}>Comply with legal obligations</li>
                </ul>
                <p className={styles.text}>
                    <strong>We do not sell Personal Information.</strong> We do not share Personal Information for cross-context behavioral advertising.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>7. Data Minimization and Purpose Limitation</h2>
                <p className={styles.text}>
                    We limit collection and processing of Personal Information to what is reasonably necessary to:
                </p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Deliver contracted services</li>
                    <li className={styles.listItem}>Maintain system security</li>
                    <li className={styles.listItem}>Fulfill legal obligations</li>
                </ul>
                <p className={styles.text}>We do not use Customer Data for unrelated commercial purposes.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>8. Disclosure of Information</h2>

                <h3 className={styles.subSectionTitle}>8.1 Service Providers (Subprocessors)</h3>
                <p className={styles.text}>We engage third-party service providers for Cloud hosting, Infrastructure services, Payment processing, and Security monitoring.</p>
                <p className={styles.text}>These providers are contractually obligated to safeguard Personal Information and process it only for authorized purposes. A list of subprocessors may be provided upon reasonable request.</p>

                <h3 className={styles.subSectionTitle}>8.2 Legal Obligations</h3>
                <p className={styles.text}>We may disclose information when required by Law, Court order, Subpoena, or Government authority.</p>

                <h3 className={styles.subSectionTitle}>8.3 Business Transfers</h3>
                <p className={styles.text}>Customer Data may be transferred as part of a Merger, Acquisition, Asset sale, or Corporate restructuring.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>9. Data Security</h2>
                <p className={styles.text}>We implement administrative, technical, and organizational safeguards designed to protect Personal Information, including:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Access controls</li>
                    <li className={styles.listItem}>Logical segregation of customer environments</li>
                    <li className={styles.listItem}>Encryption in transit</li>
                    <li className={styles.listItem}>Infrastructure-level security monitoring</li>
                </ul>
                <p className={styles.text}>No method of transmission or storage is completely secure. We do not guarantee absolute security.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>10. Security Incident Notification</h2>
                <p className={styles.text}>In the event of a confirmed security incident involving unauthorized access to Customer Data, we will notify the affected Customer without undue delay after confirmation of the incident.</p>
                <p className={styles.text}>Notification will include:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>A description of the nature of the incident</li>
                    <li className={styles.listItem}>The categories of data involved (if known)</li>
                    <li className={styles.listItem}>Steps taken to mitigate the incident</li>
                </ul>
                <p className={styles.text}>Customers remain responsible for determining any regulatory notification obligations.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>11. Data Retention</h2>
                <p className={styles.text}>We retain Customer Data for the duration of the subscription, as required to fulfill contractual obligations, or as required by law.</p>
                <p className={styles.text}>Upon termination:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Customers may export data within thirty (30) days.</li>
                    <li className={styles.listItem}>After that period, data may be permanently deleted.</li>
                </ul>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>12. Customer Control and Data Subject Requests</h2>
                <p className={styles.text}>Because the Platform is provided to organizations:</p>
                <ul className={styles.list}>
                    <li className={styles.listItem}>Customers control uploaded data.</li>
                    <li className={styles.listItem}>Individual Users should contact their organization for data access, correction, or deletion requests.</li>
                </ul>
                <p className={styles.text}>We will assist Customers in responding to verified requests where required by law.</p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>13. State Privacy Rights (U.S.)</h2>
                <p className={styles.text}>
                    Where applicable state privacy laws apply, individuals may have rights including Access, Correction, Deletion, and Data portability.
                    Because we act as a service provider, such requests should generally be directed to the Customer organization.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>14. Children’s Privacy</h2>
                <p className={styles.text}>
                    The Platform is not intended for individuals under 18. We do not knowingly collect information from minors.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>15. International Data Transfers</h2>
                <p className={styles.text}>
                    The Platform is intended for use within the United States. If accessed from outside the United States, information may be processed in the United States.
                </p>
            </section>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>16. Changes to This Policy</h2>
                <p className={styles.text}>
                    We may update this Privacy Policy periodically. The updated version will include a revised effective date. Continued use of the Platform constitutes acceptance of the revised Policy.
                </p>
            </section>

            <section className={styles.contactInfo}>
                <h2 className={styles.sectionTitle}>17. Contact Information</h2>
                <strong>Internova Technologies</strong>
                <p>431 Woodcrest Dr SE</p>
                <p>Washington, DC 20032</p>
                <p><a href="mailto:internovatechnologies@gmail.com" className="text-primary hover:underline">internovatechnologies@gmail.com</a></p>
            </section>
        </div>
    );
}
