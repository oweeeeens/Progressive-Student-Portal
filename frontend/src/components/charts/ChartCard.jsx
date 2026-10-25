// The container EVERY chart in the app sits in. Pages pass a title, an
// optional one-line description, the series legend, a plain-language
// interpretation and the chart itself; they never style the surface, the
// heading, the legend or the empty state, which is what stops each page
// slowly growing its own idea of what a chart looks like.
//
// It also owns the single empty state. Before this, a chart with no data
// could be a bordered .empty-state block on one page and a bare grey <p> on
// another; now "no data" looks the same everywhere, and a page can override
// only the SENTENCE, never the treatment.
//
// `legend` and `interpretation` live here rather than inside each chart on
// purpose — they're now required on every chart system-wide, and the one
// reliable way to make something appear everywhere is to put it in the
// component everything already goes through.
export function ChartCard({
  title,
  description,
  // [{ label, color }] — always rendered, including for single-series
  // charts, so a reader never has to infer what a colour means from the
  // title alone.
  legend,
  // One plain sentence saying what the chart MEANS ("Your average dropped
  // 12 points since Q1"), not what the axes are. The page computes it from
  // the same data it just plotted.
  interpretation,
  isEmpty = false,
  emptyMessage = 'No data recorded for this period yet',
  actions,
  children,
}) {
  return (
    <section className="chart-card">
      <div className="chart-card__head">
        <h3 className="chart-card__title">{title}</h3>
        {actions && <div className="chart-card__actions">{actions}</div>}
      </div>
      {description && <p className="chart-card__description">{description}</p>}

      {!isEmpty && legend?.length > 0 && (
        <div className="chart-legend">
          {legend.map((item) => (
            <span key={item.label} className="chart-legend__item">
              <span className="chart-legend__swatch" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}

      <div className="chart-card__body">
        {isEmpty ? <p className="chart-card__empty">{emptyMessage}</p> : children}
      </div>

      {!isEmpty && interpretation && <p className="chart-card__interpretation">{interpretation}</p>}
    </section>
  )
}

// Side-by-side chart cards that share one scale — e.g. one card per grading
// period. A plain responsive grid so three periods wrap sensibly rather than
// squeezing into three unreadable columns.
export function ChartCardRow({ children }) {
  return <div className="chart-card-row">{children}</div>
}
