import { useState } from 'react'
import { FileText, FileSpreadsheet } from 'lucide-react'
import { api } from '../../api/client'

// "Export PDF" / "Export Excel" for a report page. `path` is the report's
// JSON endpoint (e.g. "/reports/gradesheet?sectionId=3"); the exports live
// beside it at /export/pdf and /export/excel with the same query, and the
// server names the file (Content-Disposition). A failure is reported, not
// swallowed — a download that silently does nothing reads as a broken button.
export function ReportExportButtons({ path, disabled = false, onError }) {
  const [busy, setBusy] = useState(null) // 'pdf' | 'excel' | null
  const [base, query = ''] = path.split('?')

  async function download(format) {
    setBusy(format)
    onError?.(null)
    try {
      await api.downloadFile(`${base}/export/${format}${query ? `?${query}` : ''}`)
    } catch (err) {
      onError?.(`Couldn't export the ${format === 'pdf' ? 'PDF' : 'Excel file'}: ${err.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="button-row">
      <button type="button" onClick={() => download('pdf')} disabled={disabled || busy !== null}>
        <FileText size={16} strokeWidth={1.75} /> {busy === 'pdf' ? 'Generating…' : 'Export PDF'}
      </button>
      <button type="button" onClick={() => download('excel')} disabled={disabled || busy !== null}>
        <FileSpreadsheet size={16} strokeWidth={1.75} /> {busy === 'excel' ? 'Generating…' : 'Export Excel'}
      </button>
    </div>
  )
}
