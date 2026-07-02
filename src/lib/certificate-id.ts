/**
 * Canonical, human-readable certificate identifier.
 *
 * This is the single source of truth for the id shown on EVERY certificate
 * surface — the "earned" success modal, the certificate list card, the details
 * dialog, both generated PDFs (server + client export), and the public
 * verification page. Deriving it from the enrollment id keeps it stable and
 * identical everywhere.
 *
 * Note: this is a DISPLAY id only. The QR code / verification route still
 * resolve certificates by their database id (cuid), so verification is
 * unaffected by this formatting.
 */
export function formatCertificateId(enrollmentId: string): string {
  return `CERT-${enrollmentId.substring(0, 8).toUpperCase()}`;
}
