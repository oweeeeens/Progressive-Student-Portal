import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Clock, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '../api/client'
import { StatusPill } from '../components/StatusPill'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatCard, StatRow } from '../components/StatCard'

const TYPE_LABELS = { report_card: 'Report Card', birth_certificate: 'Birth Certificate', sf10: 'SF10', other: 'Other' }
const STATUS_VARIANTS = { pending: 'warning', verified: 'positive', rejected: 'negative' }
const PAGE_SIZE = 15

// "Show me everything that needs review" across all students — the actual
// approve/reject action happens on the student's detail page
// (components/EnrollmentDocuments.jsx), this is just the finding part.
export function EnrollmentQueuePage() {
  const [status, setStatus] = useState('pending')
  const [documentType, setDocumentType] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [documents, setDocuments] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    api
      .get('/enrollment-documents/stats')
      .then((data) => setCounts(data.counts))
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (status) params.set('status', status)
    if (documentType) params.set('documentType', documentType)
    if (search) params.set('search', search)

    api
      .get(`/enrollment-documents?${params.toString()}`)
      .then((data) => {
        setDocuments(data.documents)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
  }, [status, documentType, search, page])

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Enrollment Review' }]} />

      <div className="page-header">
        <h1>Enrollment Document Review</h1>
        <div className="page-header__actions">
          <div className="search-field">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Search by name or LRN"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
          </div>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => {
                setPage(1)
                setStatus(e.target.value)
              }}
            >
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="">All</option>
            </select>
          </label>
          <label>
            Document
            <select
              value={documentType}
              onChange={(e) => {
                setPage(1)
                setDocumentType(e.target.value)
              }}
            >
              <option value="">All</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {counts && (
        <StatRow>
          <StatCard icon={Clock} value={counts.pending} label="Pending review" variant="warning" />
          <StatCard icon={CheckCircle2} value={counts.verified} label="Verified" variant="positive" />
          <StatCard icon={XCircle} value={counts.rejected} label="Rejected" variant="negative" />
        </StatRow>
      )}

      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {!documents ? (
        <p>Loading documents…</p>
      ) : documents.length === 0 ? (
        <div className="empty-state">
          {search || status || documentType ? (
            <>
              <p>No documents match these filters.</p>
              <p>Try a different search term or clear the filters.</p>
            </>
          ) : (
            <p>Nothing awaiting review.</p>
          )}
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Document</th>
                <th>Status</th>
                <th>Submitted</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <Link to={`/students/${doc.student_id}`}>
                      {doc.last_name}, {doc.first_name}
                    </Link>
                  </td>
                  <td>{TYPE_LABELS[doc.document_type]}</td>
                  <td>
                    <StatusPill label={doc.status} variant={STATUS_VARIANTS[doc.status]} />
                  </td>
                  <td>{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                  <td>{doc.review_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}
