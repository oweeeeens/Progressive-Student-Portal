import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { StatusPill } from './StatusPill'

const REQUIRED_TYPES = ['report_card', 'birth_certificate', 'sf10']
const TYPE_LABELS = {
  report_card: 'Report Card',
  birth_certificate: 'Birth Certificate',
  sf10: 'SF10',
  other: 'Other',
}
const STATUS_VARIANTS = { pending: 'warning', verified: 'positive', rejected: 'negative', missing: 'neutral' }
const canReview = (role) => role === 'admin' || role === 'registrar'

export function EnrollmentDocuments({ studentId, onStudentUpdated }) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState([])
  const [requirements, setRequirements] = useState([])
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const [uploadType, setUploadType] = useState('report_card')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [reviewDrafts, setReviewDrafts] = useState({}) // { [documentId]: noteText }
  const [provisioned, setProvisioned] = useState(null) // { email, tempPassword } | null

  function load() {
    api
      .get(`/students/${studentId}/enrollment-documents`)
      .then((data) => {
        setDocuments(data.documents)
        setRequirements(data.requirements)
      })
      .catch((err) => setError(err.message))
  }

  useEffect(load, [studentId])

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('documentType', uploadType)
      formData.append('file', file)
      await api.upload(`/students/${studentId}/enrollment-documents`, formData)
      setFile(null)
      e.target.reset()
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleReview(documentId, status) {
    setMessage(null)
    try {
      const result = await api.patch(`/enrollment-documents/${documentId}/review`, {
        status,
        reviewNote: reviewDrafts[documentId] || undefined,
      })
      load()
      if (result.autoEnrolled) {
        setMessage('All required documents are verified — student has been marked Enrolled.')
        onStudentUpdated?.() // refresh the enrollment_status shown on the parent page
      }
      if (result.accountProvisioned) {
        setProvisioned(result.accountProvisioned)
      }
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(documentId) {
    try {
      await api.delete(`/enrollment-documents/${documentId}`)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  function handleDownload(doc) {
    api.downloadFile(`/enrollment-documents/${doc.id}/file`, doc.original_filename).catch((err) => setError(err.message))
  }

  return (
    <div className="record-section">
      <h2>Enrollment Documents</h2>
      {error && <p style={{ color: 'var(--color-danger)' }}>{error}</p>}
      {message && <p style={{ color: 'var(--color-success)' }}>{message}</p>}

      {provisioned && (
        <div className="alert alert--success">
          <p>
            A portal account was created for <strong>{provisioned.email}</strong>.
          </p>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Share this temporary password with the student now — it will not be shown again.
          </p>
          <code className="alert__code">{provisioned.tempPassword}</code>
        </div>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        {requirements.map((r) => (
          <StatusPill key={r.documentType} label={`${TYPE_LABELS[r.documentType]}: ${r.status}`} variant={STATUS_VARIANTS[r.status]} />
        ))}
      </div>

      {user.role === 'student' && (
        <form onSubmit={handleUpload} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <select value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
            {REQUIRED_TYPES.concat('other').map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files[0])} required />
          <button type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload Document'}
          </button>
        </form>
      )}

      {documents.length === 0 ? (
        <div className="empty-state">
          <p>No documents submitted yet.</p>
          <p>
            {user.role === 'student'
              ? 'Upload your Report Card, Birth Certificate, and SF10 above to complete enrollment.'
              : 'Documents will appear here once the student uploads them.'}
          </p>
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>File</th>
                <th>Status</th>
                <th>Note</th>
                {canReview(user.role) && <th>Review</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{TYPE_LABELS[doc.document_type]}</td>
                  <td>
                    <button type="button" onClick={() => handleDownload(doc)}>
                      {doc.original_filename}
                    </button>
                  </td>
                  <td>
                    <StatusPill label={doc.status} variant={STATUS_VARIANTS[doc.status]} />
                  </td>
                  <td>{doc.review_note || '—'}</td>
                  {canReview(user.role) && (
                    <td>
                      {doc.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <input
                            placeholder="note (optional)"
                            value={reviewDrafts[doc.id] || ''}
                            onChange={(e) => setReviewDrafts((d) => ({ ...d, [doc.id]: e.target.value }))}
                          />
                          <button type="button" onClick={() => handleReview(doc.id, 'verified')}>
                            Approve
                          </button>
                          <button type="button" onClick={() => handleReview(doc.id, 'rejected')}>
                            Reject
                          </button>
                        </div>
                      )}
                    </td>
                  )}
                  <td>
                    {(doc.status === 'pending' || canReview(user.role)) && (
                      <button type="button" onClick={() => handleDelete(doc.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
