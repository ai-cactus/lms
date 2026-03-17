'use client';

import React, { useEffect, useState, useCallback } from 'react';
import styles from './billing.module.css';

interface Invoice {
  id: string;
  invoiceNumber: string;
  amountPaid: number;
  currency: string;
  status: string;
  invoiceUrl: string | null;
  pdfUrl: string | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function getStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'paid':
      return styles.badgePaid;
    case 'open':
    case 'pending':
      return styles.badgePending;
    case 'failed':
    case 'uncollectible':
      return styles.badgeFailed;
    case 'void':
      return styles.badgeVoid;
    case 'canceled':
      return styles.badgeCanceled;
    default:
      return '';
  }
}

function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function BillingHistoryTab() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchInvoices = useCallback(async (p: number) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/billing/invoices?page=${p}`);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? 'Failed to load invoices');
      }
      const json = await res.json();
      setInvoices(json.invoices);
      setPagination(json.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInvoices(page);
  }, [fetchInvoices, page]);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.spinner} />
        <span>Loading invoices...</span>
      </div>
    );
  }

  if (error) return <div className={styles.errorBanner}>{error}</div>;

  return (
    <div>
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Invoice ID</th>
              <th>Period</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  No invoices found.
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{formatDate(inv.createdAt)}</td>
                  <td style={{ fontWeight: 500 }}>{inv.invoiceNumber}</td>
                  <td style={{ color: '#64748b', fontSize: 13 }}>
                    {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                  </td>
                  <td style={{ fontWeight: 500 }}>{formatAmount(inv.amountPaid, inv.currency)}</td>
                  <td>
                    <span className={`${styles.badge} ${getStatusBadgeClass(inv.status)}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>
                    {inv.pdfUrl ? (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.downloadLink}
                      >
                        Download
                      </a>
                    ) : inv.invoiceUrl ? (
                      <a
                        href={inv.invoiceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.downloadLink}
                      >
                        View
                      </a>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {pagination && pagination.total > 0 && (
          <div className={styles.pagination}>
            <span>
              Showing {(pagination.page - 1) * pagination.pageSize + 1}–
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
              {pagination.total} invoices
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={styles.pageBtn}
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                className={styles.pageBtn}
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
