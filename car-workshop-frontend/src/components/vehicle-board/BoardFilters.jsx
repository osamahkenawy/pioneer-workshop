/**
 * BoardFilters — the Vehicle Status Board's filter row: search, customer type
 * and category, department, Team Leader (managers and Supervisors), late
 * only, and "Show imported jobs (n)". On a phone the search stays on the page
 * and the rest sits in a bottom sheet behind a "Filters" button.
 *
 * Imported jobs: open jobs brought over from the old system — no job card, and
 * opened before the workshop's first job card (backend lib/job-phase.js
 * isLegacyJob; data.process_live_since). The board hides them unless
 * include_legacy=1; counts.legacy_hidden says how many.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Xmark, FilterList, WarningTriangle, Archive } from 'iconoir-react';
import { DEPARTMENTS, SUBCATEGORIES, classLabel, deptLabel, fmtDay, subLabel } from './board';

/** How many filters (besides the search) are on — for the phone's Filters button. */
export function activeFilterCount(f) {
  return ['cls', 'sub', 'department', 'team_leader_id'].filter(k => !!f[k]).length + (f.late ? 1 : 0) + (f.include_legacy ? 1 : 0);
}

/**
 * How many imported jobs the toggle is about: hidden ones while it is off,
 * the ones on the board while it is on. Reads the server's count under the
 * names it may use; with the toggle on and no count sent, the board's own
 * items marked `legacy`.
 */
export function importedCount(counts, includeLegacy, items = []) {
  const n = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const total = n(counts?.legacy_total) ?? n(counts?.legacy);
  if (!includeLegacy) return n(counts?.legacy_hidden) ?? n(counts?.hidden_legacy) ?? n(counts?.hidden) ?? total ?? 0;
  return total ?? n(counts?.legacy_shown) ?? items.filter(i => i.legacy && i.phase !== 'closed').length;
}

function Controls({ filters, setFilter, counts, items, liveSince, teamLeaders, canFilterTeam }) {
  const { t } = useTranslation();
  const imported = importedCount(counts, filters.include_legacy, items);
  const importedHint = liveSince
    ? t('vehicleBoard.imported_hint_since', 'Open jobs from before {{date}} with no job card, brought over from the old system.', { date: fmtDay(liveSince) })
    : t('vehicleBoard.imported_hint', 'Open jobs brought over from the old system, with no job card.');
  return (
    <>
      <div className="vsb-seg" role="group" aria-label={t('vehicleBoard.filter.type', 'Customer type')}>
        {[['', t('vehicleBoard.filter.all_types', 'All')], ['internal', classLabel(t, 'internal')], ['external', classLabel(t, 'external')]].map(([k, label]) => (
          <button key={k || 'all'} type="button" className={filters.cls === k ? 'is-on' : ''} aria-pressed={filters.cls === k}
            onClick={() => setFilter('cls', k)}>{label}</button>
        ))}
      </div>

      <div className="vsb-chips" role="group" aria-label={t('vehicleBoard.filter.category', 'Category')}>
        {SUBCATEGORIES.map(k => (
          <button key={k} type="button" className={`vsb-chip${filters.sub === k ? ' is-on' : ''}`} aria-pressed={filters.sub === k}
            onClick={() => setFilter('sub', filters.sub === k ? '' : k)}>{subLabel(t, k)}</button>
        ))}
      </div>

      <label className="vsb-select">
        <span className="vsb-sr">{t('vehicleBoard.filter.department', 'Department')}</span>
        <select value={filters.department} onChange={e => setFilter('department', e.target.value)}>
          <option value="">{t('vehicleBoard.filter.all_departments', 'All departments')}</option>
          {DEPARTMENTS.map(d => <option key={d} value={d}>{deptLabel(t, d)}</option>)}
        </select>
      </label>

      {canFilterTeam && teamLeaders?.length > 0 && (
        <label className="vsb-select">
          <span className="vsb-sr">{t('vehicleBoard.filter.team_leader', 'Team leader')}</span>
          <select value={filters.team_leader_id} onChange={e => setFilter('team_leader_id', e.target.value)}>
            <option value="">{t('vehicleBoard.filter.all_teams', 'All teams')}</option>
            {teamLeaders.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
          </select>
        </label>
      )}

      <button type="button" className={`vsb-chip is-late${filters.late ? ' is-on' : ''}`} aria-pressed={filters.late}
        onClick={() => setFilter('late', !filters.late)}>
        <WarningTriangle width={14} height={14} aria-hidden="true" />
        {t('vehicleBoard.filter.late_only', 'Late only')}
        {counts?.late != null && <span className="vsb-chip-count">{counts.late}</span>}
      </button>

      {(imported > 0 || filters.include_legacy) && (
        <button type="button" className={`vsb-chip is-legacy${filters.include_legacy ? ' is-on' : ''}`} aria-pressed={!!filters.include_legacy}
          onClick={() => setFilter('include_legacy', !filters.include_legacy)}
          title={importedHint}>
          <Archive width={14} height={14} aria-hidden="true" />
          {t('vehicleBoard.show_imported', 'Show imported jobs')}
          <span className="vsb-chip-count">{imported}</span>
        </button>
      )}
    </>
  );
}

export default function BoardFilters({ filters, setFilter, clearFilters, counts, items, liveSince, teamLeaders, canFilterTeam, phone }) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef(null);
  const active = activeFilterCount(filters);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    sheetRef.current?.querySelector('button, select')?.focus();
    const onKey = e => { if (e.key === 'Escape') setSheetOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  const search = (
    <div className="vsb-search">
      <Search width={18} height={18} className="vsb-search-icon" aria-hidden="true" />
      <input type="search" value={filters.q} onChange={e => setFilter('q', e.target.value)}
        placeholder={t('vehicleBoard.search_ph', 'Plate, WO, job card, customer, phone or VIN')}
        aria-label={t('vehicleBoard.search_ph', 'Plate, WO, job card, customer, phone or VIN')} />
      {filters.q && (
        <button type="button" className="vsb-search-clear" onClick={() => setFilter('q', '')} aria-label={t('vehicleBoard.filter.clear_search', 'Clear search')}>
          <Xmark width={16} height={16} />
        </button>
      )}
    </div>
  );

  const props = { filters, setFilter, counts, items, liveSince, teamLeaders, canFilterTeam };

  if (!phone) {
    return (
      <div className="vsb-filters">
        {search}
        <Controls {...props} />
        {active > 0 && (
          <button type="button" className="vsb-link-btn" onClick={clearFilters}>{t('vehicleBoard.filter.clear', 'Clear filters')}</button>
        )}
      </div>
    );
  }

  return (
    <div className="vsb-filters is-phone">
      {search}
      <button type="button" className={`vsb-btn vsb-filter-btn${active ? ' is-active' : ''}`} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
        <FilterList width={18} height={18} /> {t('vehicleBoard.filter.button', 'Filters')}
        {active > 0 && <span className="vsb-chip-count">{active}</span>}
      </button>
      {sheetOpen && (
        <>
          <div className="vsb-overlay" onClick={() => setSheetOpen(false)} aria-hidden="true" />
          <div ref={sheetRef} className="vsb-sheet" role="dialog" aria-modal="true" aria-label={t('vehicleBoard.filter.button', 'Filters')}>
            <div className="vsb-sheet-head">
              <strong>{t('vehicleBoard.filter.button', 'Filters')}</strong>
              <button type="button" className="vsb-icon-btn" onClick={() => setSheetOpen(false)} aria-label={t('vehicleBoard.drawer.close', 'Close')}>
                <Xmark width={20} height={20} />
              </button>
            </div>
            <div className="vsb-sheet-body">
              <Controls {...props} />
            </div>
            <div className="vsb-sheet-foot">
              <button type="button" className="vsb-btn" onClick={clearFilters} disabled={!active}>{t('vehicleBoard.filter.clear', 'Clear filters')}</button>
              <button type="button" className="vsb-btn is-primary" onClick={() => setSheetOpen(false)}>{t('vehicleBoard.filter.done', 'Show cars')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
