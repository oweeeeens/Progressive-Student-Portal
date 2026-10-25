// Per-chart field picker: which series/categories are currently drawn.
// Separate from the page-level filters above the tabs — those change WHICH
// STUDENTS are counted, these only change which of the resulting series is
// drawn, so a counselor can isolate the one line they care about without
// changing any number on the page.
//
// Doubles as the chart's legend when it's shown (same swatch + label in the
// same order), so a chart never carries two near-identical colour keys.
export function ChartFieldToggles({ fields, hidden, onToggle, label = 'Show' }) {
  return (
    <div className="chart-toggles">
      <span className="chart-toggles__label">{label}</span>
      {fields.map((field) => {
        const isOff = hidden.has(field.key)
        return (
          <button
            key={field.key}
            type="button"
            className={`chart-toggle${isOff ? ' is-off' : ''}`}
            aria-pressed={!isOff}
            onClick={() => onToggle(field.key)}
            title={isOff ? `Show ${field.label}` : `Hide ${field.label}`}
          >
            <span className="chart-toggle__swatch" style={{ background: field.color }} />
            {field.label}
          </button>
        )
      })}
    </div>
  )
}
