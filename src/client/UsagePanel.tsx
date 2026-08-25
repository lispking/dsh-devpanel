/**
 * Usage stats panel for dsh-devpanel: a modal dashboard merging TWO usage
 * dimensions — AI activity (tokens, calls, messages, models) and terminal
 * activity (sessions, commands, wall time), the dimension only dsh-devpanel
 * can see because it owns the PTY terminal panel.
 *
 * Rendered as a fixed overlay from the session-header actions; all data comes
 * from the `usagePanel` Remote face (src/usage.ts). No chart library — the
 * trend, heatmap and model bars are plain divs sized with percentage heights
 * (the embedded WebView drops `calc()` `*` multiplication, so widths/heights
 * are computed in JS as plain numbers).
 * @module dsh-devpanel/client/UsagePanel
 */

import { useEffect, useMemo, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  UsageCallsPage,
  UsageCallsQuery,
  UsageDayStats,
  UsageQuery,
  UsageScope,
  UsageSnapshot,
  UsageTerminalsPage,
  UsageTerminalsQuery,
} from '../usage-types.ts'
import type { ConsoleKey } from './locales.ts'

/** The typed `ctx.remote.usagePanel` face the panel calls. */
export interface UsagePanelFace {
  snapshot: (query: UsageQuery, signal?: AbortSignal) => Promise<RemoteResult<UsageSnapshot>>
  calls: (query: UsageCallsQuery, signal?: AbortSignal) => Promise<RemoteResult<UsageCallsPage>>
  terminals: (query: UsageTerminalsQuery, signal?: AbortSignal) => Promise<RemoteResult<UsageTerminalsPage>>
  exportCsv: (query: UsageQuery, signal?: AbortSignal) => Promise<RemoteResult<{ filename: string; body: string }>>
  exportJson: (query: UsageQuery, signal?: AbortSignal) => Promise<RemoteResult<{ filename: string; body: string }>>
}

/** Full component props: the Remote face, a close callback, and the locale seat. */
export interface UsagePanelProps {
  usagePanel: UsagePanelFace
  onClose: () => void
  t: (key: ConsoleKey) => string
}

/** Range presets offered by the toolbar. */
type RangeDays = 7 | 30 | 90

/** `YYYY-MM-DD` for a local date. */
function dateStr(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Compact number: 1234 → '1.2k'. */
function compact(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(value))
}

/** Wall time: 95_000 → '1m 35s'; 3_200 → '3.2s'; 7_200_000 → '2h 0m'. */
function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  if (ms < 1_000) return `${Math.round(ms)}ms`
  const seconds = ms / 1_000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Terminal wall time in a friendlier unit for the overview card. */
function formatTerminalTime(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, '')}h`
}

/** Short localized time for a detail row. */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** One hover tooltip: a fixed-position bubble that follows the cursor. */
interface TooltipState {
  x: number
  y: number
  title: string
  rows: Array<{ label: string; value: string }>
}

/** Manage a hover tooltip's state; `show` clamps the bubble to the viewport. */
function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const show = (event: React.MouseEvent, title: string, rows: Array<{ label: string; value: string }>): void => {
    setTip({
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - 280)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 140)),
      title,
      rows,
    })
  }
  const hide = (): void => setTip(null)
  return { tip, show, hide }
}

/** Render the hover tooltip (fixed-position, so it escapes the panel's overflow). */
function Tooltip({ tip }: { tip: TooltipState | null }): React.JSX.Element | null {
  if (tip === null) return null
  return (
    <div className="dsh-usage-tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="dsh-usage-tooltip-title">{tip.title}</div>
      {tip.rows.map((row, index) => (
        <div key={index} className="dsh-usage-tooltip-row">
          <span>{row.label}</span>
          <span className="dsh-usage-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

/** One overview stat card. */
function StatCard({ label, value, dim }: { label: string; value: string; dim?: string }): React.JSX.Element {
  return (
    <div className="dsh-usage-card">
      <div className="dsh-usage-card-label">{label}</div>
      <div className="dsh-usage-card-value">{value}</div>
      {dim !== undefined && <div className="dsh-usage-card-dim">{dim}</div>}
    </div>
  )
}

/** The dual-dimension overview card grid. */
function OverviewCards({ snapshot, t }: { snapshot: UsageSnapshot; t: (key: ConsoleKey) => string }): React.JSX.Element {
  const totals = snapshot.totals
  return (
    <div className="dsh-usage-cards">
      <StatCard label={t('usage.overview.aiTokens')} value={compact(totals.aiTokens)} />
      <StatCard label={t('usage.overview.aiCalls')} value={compact(totals.aiCalls)} />
      <StatCard label={t('usage.overview.aiMessages')} value={compact(totals.aiMessages)} />
      <StatCard label={t('usage.overview.aiSessions')} value={compact(totals.aiSessions)} />
      <StatCard
        label={t('usage.overview.aiActiveDays')}
        value={compact(totals.aiActiveDays)}
        dim={`${t('usage.overview.aiStreak')} ${compact(totals.aiCurrentStreak)}`}
      />
      <StatCard label={t('usage.overview.terminalSessions')} value={compact(totals.terminalSessions)} />
      <StatCard label={t('usage.overview.commands')} value={compact(totals.commands)} />
      <StatCard
        label={t('usage.overview.terminalMs')}
        value={formatTerminalTime(totals.terminalMs)}
        dim={`${t('usage.overview.terminalActiveDays')} ${compact(totals.terminalActiveDays)}`}
      />
    </div>
  )
}

/** Daily dual-dimension trend: AI tokens and terminal commands as overlaid lines. */
function TrendChart({ snapshot, t }: { snapshot: UsageSnapshot; t: (key: ConsoleKey) => string }): React.JSX.Element {
  const { tip, show, hide } = useTooltip()
  const days = snapshot.days
  const maxTokens = Math.max(1, ...days.map(day => day.aiTokens))
  const maxCommands = Math.max(1, ...days.map(day => day.commands))
  const hasData = days.some(day => day.aiTokens > 0 || day.commands > 0 || day.terminalSessions > 0)
  if (!hasData) {
    return <div className="dsh-usage-empty">{t('usage.trend.noData')}</div>
  }
  // Space the date labels so 30/90-day ranges don't cram every MM-DD together.
  const labelStep = Math.max(1, Math.ceil(days.length / 10))
  const rowsFor = (day: UsageDayStats): Array<{ label: string; value: string }> => [
    { label: t('usage.trend.aiTokens'), value: String(day.aiTokens) },
    { label: t('usage.trend.commands'), value: String(day.commands) },
  ]
  // Two overlaid polylines in a 1000×120 viewBox; each series is normalized to
  // its own maximum so token volume and command counts share one plot.
  const W = 1000
  const H = 120
  const PAD = 8
  const step = days.length <= 1 ? 0 : W / (days.length - 1)
  const y = (value: number, max: number): number => H - PAD - (value / max) * (H - 2 * PAD)
  const tokensPath = days.map((day, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${y(day.aiTokens, maxTokens).toFixed(1)}`).join(' ')
  const commandsPath = days.map((day, index) => `${index === 0 ? 'M' : 'L'}${(index * step).toFixed(1)},${y(day.commands, maxCommands).toFixed(1)}`).join(' ')
  return (
    <>
      <div className="dsh-usage-trend-legend">
        <span className="dsh-usage-trend-legend-item"><i className="dsh-usage-swatch ai" />{t('usage.trend.aiTokens')}</span>
        <span className="dsh-usage-trend-legend-item"><i className="dsh-usage-swatch term" />{t('usage.trend.commands')}</span>
      </div>
      <div className="dsh-usage-trend">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="dsh-usage-trend-svg">
          <path d={tokensPath} className="dsh-usage-trend-line ai" vectorEffect="non-scaling-stroke" />
          <path d={commandsPath} className="dsh-usage-trend-line term" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="dsh-usage-trend-hover">
          {days.map(day => (
            <div
              key={day.date}
              className="dsh-usage-trend-cell"
              onMouseEnter={(event) => show(event, day.date, rowsFor(day))}
              onMouseMove={(event) => show(event, day.date, rowsFor(day))}
              onMouseLeave={hide}
            />
          ))}
        </div>
      </div>
      <div className="dsh-usage-trend-x">
        {days.map((day, index) => (
          <div key={day.date} className="dsh-usage-trend-xcell">
            {(index % labelStep === 0 || index === days.length - 1) && (
              <span className="dsh-usage-trend-label">{day.date.slice(5)}</span>
            )}
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </>
  )
}

/** Combined per-day activity score for the heatmap (tokens/1k + commands +
 *  terminal sessions + terminal minutes). */
function dayScore(day: { aiTokens: number; commands: number; terminalSessions: number; terminalMs: number }): number {
  return (day.aiTokens / 1000) + day.commands + (day.terminalSessions * 5) + (day.terminalMs / 60_000)
}

/** GitHub-style yearly activity heatmap (weeks × weekdays), colored by score. */
function Heatmap({ snapshot, t }: { snapshot: UsageSnapshot | null; t: (key: ConsoleKey) => string }): React.JSX.Element {
  const { tip, show, hide } = useTooltip()
  const cells = useMemo(() => {
    if (snapshot === null) return null
    const byDate = new Map(snapshot.days.map(day => [day.date, day]))
    const scores = new Map<string, number>()
    let maxScore = 0
    for (const [date, day] of byDate) {
      const score = dayScore(day)
      scores.set(date, score)
      if (score > maxScore) maxScore = score
    }
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - 364)
    // Align the grid to Monday so weeks render as columns.
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const columns: Array<Array<{ date: string; score: number; level: number; day: UsageDayStats | undefined }>> = []
    const cursor = new Date(start)
    while (cursor <= end) {
      const week: Array<{ date: string; score: number; level: number; day: UsageDayStats | undefined }> = []
      for (let i = 0; i < 7; i += 1) {
        const date = dateStr(cursor)
        const score = scores.get(date) ?? 0
        const ratio = maxScore === 0 ? 0 : score / maxScore
        const level = score === 0 ? 0 : ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : 1
        week.push({ date, score, level, day: byDate.get(date) })
        cursor.setDate(cursor.getDate() + 1)
      }
      columns.push(week)
    }
    return { columns }
  }, [snapshot])
  const hasAny = snapshot !== null && snapshot.days.some(day => dayScore(day) > 0)
  if (cells === null || !hasAny) {
    return <div className="dsh-usage-empty">{t('usage.heatmap.noData')}</div>
  }
  const rowsFor = (day: UsageDayStats | undefined): Array<{ label: string; value: string }> => {
    if (day === undefined) return []
    return [
      { label: t('usage.trend.aiTokens'), value: String(day.aiTokens) },
      { label: t('usage.trend.commands'), value: String(day.commands) },
      { label: t('usage.overview.terminalSessions'), value: String(day.terminalSessions) },
      { label: t('usage.overview.terminalMs'), value: formatDuration(day.terminalMs) },
    ]
  }
  return (
    <>
      <div className="dsh-usage-heatmap">
        {cells.columns.map((week, wi) => (
          <div key={wi} className="dsh-usage-heat-week">
            {week.map(cell => (
              <div
                key={cell.date}
                className={`dsh-usage-heat-cell l${cell.level}`}
                onMouseEnter={(event) => show(event, cell.date, rowsFor(cell.day))}
                onMouseMove={(event) => show(event, cell.date, rowsFor(cell.day))}
                onMouseLeave={hide}
              />
            ))}
          </div>
        ))}
      </div>
      <Tooltip tip={tip} />
    </>
  )
}

/** Horizontal model-share bars. */
function ModelShare({ snapshot, t }: { snapshot: UsageSnapshot; t: (key: ConsoleKey) => string }): React.JSX.Element {
  const models = snapshot.models
  if (models.length === 0) return <div className="dsh-usage-empty">{t('usage.models.empty')}</div>
  return (
    <div className="dsh-usage-models">
      {models.map(model => (
        <div key={model.key} className="dsh-usage-model-row">
          <div className="dsh-usage-model-name" title={`${model.provider}/${model.model}`}>{model.model}</div>
          <div className="dsh-usage-model-bar">
            <div className="dsh-usage-model-fill" style={{ width: `${model.percent}%` }} />
          </div>
          <div className="dsh-usage-model-meta">{compact(model.tokens)} · {model.percent.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  )
}

/** Horizontal tool-share bars (which command names dominated the range). */
function ToolShare({ snapshot, t }: { snapshot: UsageSnapshot; t: (key: ConsoleKey) => string }): React.JSX.Element {
  const tools = snapshot.tools
  if (tools.length === 0) return <div className="dsh-usage-empty">{t('usage.terminals.toolsEmpty')}</div>
  return (
    <div className="dsh-usage-models">
      {tools.map(tool => (
        <div key={tool.name} className="dsh-usage-model-row">
          <div className="dsh-usage-model-name" title={tool.name}>{tool.name}</div>
          <div className="dsh-usage-model-bar">
            <div className="dsh-usage-model-fill" style={{ width: `${tool.percent}%` }} />
          </div>
          <div className="dsh-usage-model-meta">{compact(tool.count)} · {tool.percent.toFixed(1)}%</div>
        </div>
      ))}
    </div>
  )
}

/** Shared pagination bar. */
function Pager({ page, pageSize, total, hasMore, onPage, t }: {
  page: number
  pageSize: number
  total: number
  hasMore: boolean
  onPage: (page: number) => void
  t: (key: ConsoleKey) => string
}): React.JSX.Element {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="dsh-usage-pager">
      <button
        type="button"
        className="dsh-usage-pager-btn"
        disabled={page <= 1}
        aria-label={t('usage.pager.prev')}
        title={t('usage.pager.prev')}
        onClick={() => onPage(page - 1)}
      >‹</button>
      <span className="dsh-usage-pager-info">{page} / {totalPages}</span>
      <button
        type="button"
        className="dsh-usage-pager-btn"
        disabled={!hasMore}
        aria-label={t('usage.pager.next')}
        title={t('usage.pager.next')}
        onClick={() => onPage(page + 1)}
      >›</button>
    </div>
  )
}

/** Paginated assistant-call detail table. */
function CallsTable({ page, pageSize, onPageSizeChange, t, onPage }: {
  page: UsageCallsPage | null
  pageSize: number
  onPageSizeChange: (size: number) => void
  t: (key: ConsoleKey) => string
  onPage: (page: number) => void
}): React.JSX.Element {
  if (page === null) return <div className="dsh-usage-loading">{t('usage.loading')}</div>
  if (page.items.length === 0) return <div className="dsh-usage-empty">{t('usage.calls.empty')}</div>
  return (
    <div className="dsh-usage-table-wrap">
      <table className="dsh-usage-table">
        <thead>
          <tr>
            <th>{t('usage.calls.time')}</th>
            <th>{t('usage.calls.model')}</th>
            <th>{t('usage.calls.effort')}</th>
            <th>{t('usage.calls.duration')}</th>
            <th className="num">{t('usage.calls.input')}</th>
            <th className="num">{t('usage.calls.output')}</th>
            <th className="num">{t('usage.calls.cache')}</th>
            <th className="num">{t('usage.calls.reasoning')}</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map(call => (
            <tr key={call.key}>
              <td>{formatTime(call.time)}</td>
              <td title={`${call.provider}/${call.model}`}>{call.model}</td>
              <td>{call.effort ?? '—'}</td>
              <td>{formatDuration(call.durationMs)}</td>
              <td className="num">{compact(call.tokens.input)}</td>
              <td className="num">{compact(call.tokens.output)}</td>
              <td className="num">{compact(call.tokens.cacheRead + call.tokens.cacheWrite)}</td>
              <td className="num">{compact(call.tokens.reasoning)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dsh-usage-table-footer">
        <label className="dsh-usage-select">
          <span>{t('usage.pager.pageSize')}</span>
          <select value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>
            {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <Pager page={page.page} pageSize={page.pageSize} total={page.total} hasMore={page.hasMore} onPage={onPage} t={t} />
      </div>
    </div>
  )
}

/** Paginated terminal-session detail table. */
function TerminalsTable({ page, pageSize, onPageSizeChange, t, onPage }: {
  page: UsageTerminalsPage | null
  pageSize: number
  onPageSizeChange: (size: number) => void
  t: (key: ConsoleKey) => string
  onPage: (page: number) => void
}): React.JSX.Element {
  if (page === null) return <div className="dsh-usage-loading">{t('usage.loading')}</div>
  if (page.items.length === 0) return <div className="dsh-usage-empty">{t('usage.terminals.empty')}</div>
  return (
    <div className="dsh-usage-table-wrap">
      <table className="dsh-usage-table">
        <thead>
          <tr>
            <th>{t('usage.terminals.started')}</th>
            <th>{t('usage.terminals.shell')}</th>
            <th>{t('usage.terminals.cwd')}</th>
            <th>{t('usage.terminals.duration')}</th>
            <th>{t('usage.terminals.exit')}</th>
            <th className="num">{t('usage.terminals.commands')}</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map(term => (
            <tr key={term.id}>
              <td>{formatTime(term.startedAt)}</td>
              <td>{term.shell}</td>
              <td title={term.cwd ?? undefined}>{term.cwd ?? '—'}</td>
              <td>{term.endedAt === null ? t('usage.terminals.running') : formatDuration(term.durationMs)}</td>
              <td>{term.endedAt === null ? '—' : term.signal ?? String(term.exitCode ?? '')}</td>
              <td
                className="num dsh-usage-commands"
                title={term.commands.map(command => `${command.name} ×${command.count}`).join('\n')}
              >{term.commandCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dsh-usage-table-footer">
        <label className="dsh-usage-select">
          <span>{t('usage.pager.pageSize')}</span>
          <select value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>
            {[10, 20, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <Pager page={page.page} pageSize={page.pageSize} total={page.total} hasMore={page.hasMore} onPage={onPage} t={t} />
      </div>
    </div>
  )
}

/**
 * The usage stats panel: a fixed modal overlay driven by the `usagePanel`
 * Remote face. Fetches a range snapshot (overview/trend/models), a year
 * snapshot (heatmap), and paginated call + terminal detail pages; re-fetches
 * when the range, scope, or workspace filter changes.
 * @param props - Remote face, close callback, and locale seat.
 * @returns the modal overlay, or nothing when the panel is closed by the parent.
 */
export function UsagePanel({ usagePanel, onClose, t }: UsagePanelProps): React.JSX.Element {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30)
  const [tab, setTab] = useState<'overview' | 'calls' | 'terminals'>('overview')
  const [scope, setScope] = useState<UsageScope>('all')
  const [workspace, setWorkspace] = useState<string | undefined>(undefined)
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  const [year, setYear] = useState<UsageSnapshot | null>(null)
  const [calls, setCalls] = useState<UsageCallsPage | null>(null)
  const [callsPage, setCallsPage] = useState(1)
  const [callsPageSize, setCallsPageSize] = useState(25)
  const [terminals, setTerminals] = useState<UsageTerminalsPage | null>(null)
  const [terminalsPage, setTerminalsPage] = useState(1)
  const [terminalsPageSize, setTerminalsPageSize] = useState(20)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const timeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' }
  }, [])

  // Inclusive local date range for the selected preset.
  const range = useMemo(() => {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (rangeDays - 1))
    return { from: dateStr(from), to: dateStr(to) }
  }, [rangeDays])

  // Range snapshot (overview, trend, models).
  useEffect(() => {
    let cancelled = false
    setError(null)
    const query: UsageQuery = {
      from: range.from,
      to: range.to,
      timeZone,
      scope,
      ...(workspace === undefined ? {} : { workspace }),
    }
    void usagePanel.snapshot(query).then(result => {
      if (cancelled) return
      if (!result.ok) { setError(result.error?.message ?? 'unknown'); return }
      setSnapshot(result.value)
    }).catch(() => {
      if (!cancelled) setError('transport')
    })
    return () => { cancelled = true }
  }, [usagePanel, range.from, range.to, timeZone, scope, workspace])

  // Year snapshot (heatmap), independent of the range preset.
  useEffect(() => {
    let cancelled = false
    const to = new Date()
    const from = new Date()
    from.setFullYear(from.getFullYear() - 1)
    const query: UsageQuery = {
      from: dateStr(from),
      to: dateStr(to),
      timeZone,
      scope,
      ...(workspace === undefined ? {} : { workspace }),
    }
    void usagePanel.snapshot(query).then(result => {
      if (!cancelled && result.ok) setYear(result.value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [usagePanel, timeZone, scope, workspace])

  // Paginated call details.
  useEffect(() => {
    let cancelled = false
    const query: UsageCallsQuery = {
      from: range.from,
      to: range.to,
      timeZone,
      scope,
      ...(workspace === undefined ? {} : { workspace }),
      page: callsPage,
      pageSize: callsPageSize,
    }
    void usagePanel.calls(query).then(result => {
      if (!cancelled && result.ok) setCalls(result.value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [usagePanel, range.from, range.to, timeZone, scope, workspace, callsPage, callsPageSize])

  // Paginated terminal details.
  useEffect(() => {
    let cancelled = false
    const query: UsageTerminalsQuery = {
      from: range.from,
      to: range.to,
      timeZone,
      ...(workspace === undefined ? {} : { workspace }),
      page: terminalsPage,
      pageSize: terminalsPageSize,
    }
    void usagePanel.terminals(query).then(result => {
      if (!cancelled && result.ok) setTerminals(result.value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [usagePanel, range.from, range.to, timeZone, workspace, terminalsPage, terminalsPageSize])

  // Escape closes the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Download the CSV/JSON export for the current filters.
  const exportFile = (kind: 'csv' | 'json'): void => {
    const query: UsageQuery = {
      from: range.from,
      to: range.to,
      timeZone,
      scope,
      ...(workspace === undefined ? {} : { workspace }),
    }
    setDownloading(true)
    const call = kind === 'csv' ? usagePanel.exportCsv(query) : usagePanel.exportJson(query)
    void call.then(result => {
      setDownloading(false)
      if (!result.ok) return
      const url = URL.createObjectURL(new Blob([result.value.body], {
        type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
      }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.value.filename
      anchor.click()
      URL.revokeObjectURL(url)
    }).catch(() => { setDownloading(false) })
  }

  return (
    <div className="dsh-usage-overlay" onClick={onClose}>
      <div className="dsh-usage-panel" role="dialog" aria-label={t('usage.title')} onClick={event => event.stopPropagation()}>
        <div className="dsh-usage-header">
          <div className="dsh-usage-title">{t('usage.title')}</div>
          <div className="dsh-usage-toolbar">
            <div className="dsh-usage-tabs" role="tablist" aria-label={t('usage.title')}>
              {([7, 30, 90] as const).map(days => (
                <button
                  key={days}
                  type="button"
                  role="tab"
                  aria-selected={rangeDays === days}
                  className={`dsh-usage-tab${rangeDays === days ? ' active' : ''}`}
                  onClick={() => { setRangeDays(days); setCallsPage(1); setTerminalsPage(1) }}
                >{t(`usage.range.${days}d` as ConsoleKey)}</button>
              ))}
            </div>
            <label className="dsh-usage-select">
              <span>{t('usage.scope.label')}</span>
              <select value={scope} onChange={event => { setScope(event.target.value as UsageScope); setCallsPage(1) }}>
                <option value="all">{t('usage.scope.all')}</option>
                <option value="main">{t('usage.scope.main')}</option>
                <option value="subtasks">{t('usage.scope.subtasks')}</option>
              </select>
            </label>
            {snapshot !== null && snapshot.workspaces.length > 0 && (
              <label className="dsh-usage-select">
                <select
                  value={workspace ?? ''}
                  onChange={event => { setWorkspace(event.target.value === '' ? undefined : event.target.value); setCallsPage(1) }}
                >
                  <option value="">{t('usage.workspace.all')}</option>
                  {snapshot.workspaces.map(ws => (
                    <option key={ws.path} value={ws.path}>{ws.path}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="dsh-usage-export">
              <button type="button" className="dsh-usage-btn" disabled={downloading} onClick={() => exportFile('csv')}>{t('usage.export.csv')}</button>
              <button type="button" className="dsh-usage-btn" disabled={downloading} onClick={() => exportFile('json')}>{t('usage.export.json')}</button>
            </div>
            <button
              type="button"
              className="dsh-usage-close"
              onClick={onClose}
              aria-label={t('usage.close')}
              title={t('usage.close')}
            >×</button>
          </div>
        </div>
        <div className="dsh-usage-tabbar" role="tablist" aria-label={t('usage.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overview'}
            className={`dsh-usage-tabbar-tab${tab === 'overview' ? ' active' : ''}`}
            onClick={() => setTab('overview')}
          >{t('usage.tab.overview')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'calls'}
            className={`dsh-usage-tabbar-tab${tab === 'calls' ? ' active' : ''}`}
            onClick={() => setTab('calls')}
          >{t('usage.tab.calls')}</button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'terminals'}
            className={`dsh-usage-tabbar-tab${tab === 'terminals' ? ' active' : ''}`}
            onClick={() => setTab('terminals')}
          >{t('usage.tab.terminals')}</button>
        </div>
        <div className="dsh-usage-body">
          {error !== null && <div className="dsh-usage-error">{t('usage.error')} — {error}</div>}
          {snapshot === null && error === null && <div className="dsh-usage-loading">{t('usage.loading')}</div>}
          {snapshot !== null && (
            <>
              {tab === 'overview' && (
                <>
                  <OverviewCards snapshot={snapshot} t={t} />
                  <section className="dsh-usage-section">
                    <h3 className="dsh-usage-section-title">{t('usage.section.trend')}</h3>
                    <TrendChart snapshot={snapshot} t={t} />
                  </section>
                  <section className="dsh-usage-section">
                    <h3 className="dsh-usage-section-title">{t('usage.section.heatmap')}</h3>
                    <Heatmap snapshot={year} t={t} />
                  </section>
                  <section className="dsh-usage-section">
                    <h3 className="dsh-usage-section-title">{t('usage.section.models')}</h3>
                    <ModelShare snapshot={snapshot} t={t} />
                  </section>
                </>
              )}
              {tab === 'calls' && (
                <section className="dsh-usage-section">
                  <CallsTable
                    page={calls}
                    pageSize={callsPageSize}
                    onPageSizeChange={(size) => { setCallsPageSize(size); setCallsPage(1) }}
                    t={t}
                    onPage={setCallsPage}
                  />
                </section>
              )}
              {tab === 'terminals' && (
                <section className="dsh-usage-section">
                  <ToolShare snapshot={snapshot} t={t} />
                  <TerminalsTable
                    page={terminals}
                    pageSize={terminalsPageSize}
                    onPageSizeChange={(size) => { setTerminalsPageSize(size); setTerminalsPage(1) }}
                    t={t}
                    onPage={setTerminalsPage}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default UsagePanel
