/**
 * TechnicianPicker — choose a technician for a job, seeing who is free
 * (client feedback, 16 Nov 2026, point 4: "it doesn't show me the
 * availability"). Used by the job card's "Jobs and technicians"
 * (JobTasksPanel) and the Team Board's Assign dialog (pages/TeamLeader.jsx).
 *
 * The list comes from the server in one go (GET /api/job-tasks →
 * technicians, backend lib/technician-availability.js technicianRoster):
 * each technician's state now (available / on a job with the clock running /
 * busy with open jobs / on break / off), open jobs, today's booked time,
 * team and skills. Here it is only sorted and filtered:
 *
 *   qualified for the job's service type first (every job's, when one
 *   technician is picked for several), then the board's team, then the
 *   freest (available → busy / working → on break → off), then fewest open
 *   jobs. A technician not qualified is offered to a manager only — the
 *   caller asks for the override reason — and shown greyed to everyone
 *   else; one the HR feed marks unavailable cannot be picked.
 *
 * Searchable (name, team, specialty); keyboard: ↑ ↓ Enter Esc. The list
 * opens in the page flow under the button (no floating layer to clip inside
 * a dialog or on a tablet).
 *
 * Props:
 *   technicians    the roster
 *   value          the chosen technician's id (or null)
 *   currentId      the job's technician now (marked "Now")
 *   serviceTypes   the service type keys the choice must cover (null / [] = any)
 *   serviceLabels  key → label (GET /api/job-tasks service_types)
 *   canOverride    a manager: technicians not qualified can be picked (override)
 *   canLearn       anyone who assigns: technicians not qualified can be picked, and the
 *                  screen then records the skill on them (client feedback 18 Nov, point 8)
 *   preferTeamId   the team leader whose technicians come first
 *   onChange(id, { qualified, tech })
 *   placeholder, disabled, label (accessible name), autoOpen
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavArrowDown, Search, Check, WarningTriangle, Xmark } from 'iconoir-react';
import './TechnicianPicker.css';

const AVATAR_BG = ['#1e3a6b', '#0369a1', '#0e7490', '#7c3aed', '#b45309', '#be185d'];
const STATE_RANK = { available: 0, busy: 1, working: 1, on_break: 2, off: 3 };

const norm = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** "Hassan (AC & electrical)" → "Hassan" */
const shortName = full => String(full || '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(full || '');
function initials(full) {
  const words = (shortName(full).match(/[\p{L}\p{N}]+/gu) || []).filter(w => /\p{L}/u.test(w));
  if (!words.length) return '?';
  const first = [...words[0]][0];
  return (words.length > 1 ? first + [...words[words.length - 1]][0] : first).toUpperCase();
}
export const fmtMinutes = min => {
  const m = Math.max(0, Math.round(Number(min) || 0));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}`;
};
const hhmm = s => (s ? String(s).replace('T', ' ').slice(11, 16) : '');
const isToday = s => {
  if (!s) return true;
  const d = new Date(String(s).replace(' ', 'T'));
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

/** How well a technician fits the service types: 'all' | 'some' | 'none' (no types: 'all'). */
export function fitOf(tech, serviceTypes) {
  const types = [...new Set((serviceTypes || []).filter(Boolean))];
  if (!types.length) return 'all';
  const skills = Array.isArray(tech?.skills) ? tech.skills : [];
  const n = types.filter(x => skills.includes(x)).length;
  return n === types.length ? 'all' : n ? 'some' : 'none';
}

/** Best first: qualified, the board's team, freest, fewest open jobs, least booked, name. */
export function rankTechnicians(techs, serviceTypes, preferTeamId) {
  const fitRank = { all: 0, some: 1, none: 2 };
  const key = x => [
    x.available === false ? 1 : 0,
    fitRank[fitOf(x, serviceTypes)],
    preferTeamId && Number(x.team_leader_id) === Number(preferTeamId) ? 0 : 1,
    STATE_RANK[x.state] ?? 3,
    Number(x.open_jobs) || 0,
    Number(x.booked_min_today) || 0,
  ];
  return [...(techs || [])].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return shortName(a.full_name).localeCompare(shortName(b.full_name));
  });
}

/** The state in words ("On WO-…4271 · since 09:12", "Busy · 2 open jobs"). */
export function StateBadge({ tech }) {
  const { t } = useTranslation();
  const r = tech.running;
  const text = {
    available: t('techPicker.state_available', 'Available'),
    working: r
      ? t('techPicker.state_working_on', 'Clock running · {{wo}} since {{time}}', {
        wo: r.work_order_number ? `…${String(r.work_order_number).slice(-4)}` : r.job_card_number, time: hhmm(r.since) + (isToday(r.since) ? '' : ` (${String(r.since).slice(5, 10)})`),
      })
      : t('techPicker.state_working', 'Clock running'),
    busy: Number(tech.open_jobs) === 1 ? t('techPicker.state_busy_one', 'Busy · 1 open job')
      : t('techPicker.state_busy_n', 'Busy · {{n}} open jobs', { n: Number(tech.open_jobs) || 0 }),
    on_break: t('techPicker.state_on_break', 'On break'),
    off: tech.available === false
      ? t('techPicker.state_unavailable', 'Not available')
      : t('techPicker.state_off', 'Off'),
  }[tech.state] || tech.state;
  return (
    <span className={`tp-state is-${tech.state}`} title={r?.job_name ? `${r.job_name} · ${r.job_card_number}` : undefined}>
      <i aria-hidden="true" />{text}
    </span>
  );
}

export default function TechnicianPicker({
  technicians = [], value = null, currentId = null, serviceTypes = null, serviceLabels = {}, canOverride = false, canLearn = false,
  preferTeamId = null, onChange, placeholder, disabled = false, label, autoOpen = false,
}) {
  const { t } = useTranslation();
  const uid = useId();
  const [open, setOpen] = useState(autoOpen);
  const [q, setQ] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const btnRef = useRef(null);

  const types = useMemo(() => [...new Set((serviceTypes || []).filter(Boolean))], [serviceTypes]);
  const typeText = types.map(k => t(`jobTasks.type.${k}`, serviceLabels[k] || k)).join(', ');
  const ranked = useMemo(() => rankTechnicians(technicians, types, preferTeamId), [technicians, types, preferTeamId]);
  const selected = technicians.find(x => Number(x.id) === Number(value)) || null;
  // "Team" marks the board's team only when others are listed too.
  const mixedTeams = !!preferTeamId && technicians.some(x => Number(x.team_leader_id) !== Number(preferTeamId));

  const needle = norm(q.trim());
  const matches = needle
    ? ranked.filter(x => norm([x.full_name, x.team_leader_name, x.specialty].filter(Boolean).join(' ')).includes(needle))
    : ranked;
  const fits = x => fitOf(x, types);
  const good = matches.filter(x => fits(x) === 'all');
  const some = matches.filter(x => fits(x) === 'some');
  const none = matches.filter(x => fits(x) === 'none');
  // Not qualified: a manager's override; greyed for everyone else (folded while not searching).
  const othersOpen = canOverride || canLearn || showOthers || !!needle;
  const groups = [
    { key: 'good', items: good, title: types.length ? t('techPicker.group_qualified', 'Qualified for {{type}}', { type: typeText }) : t('techPicker.group_all', 'Technicians') },
    { key: 'some', items: some, title: t('techPicker.group_some', 'Qualified for some of these jobs') },
    { key: 'none', items: othersOpen ? none : [], title: canLearn ? t('techPicker.group_learn', 'Skill not on file yet — picking one adds the skill to their record') : canOverride ? t('techPicker.group_override', 'Not qualified — manager override, with a reason') : t('techPicker.group_not_qualified', 'Not qualified — a manager can override') },
  ].filter(g => g.items.length);
  // 'some' (several jobs): it goes to the jobs they are qualified for — the caller says which.
  const pickable = x => x.available !== false && (fits(x) !== 'none' || canOverride || canLearn);
  const flat = groups.flatMap(g => g.items);
  const enabled = flat.filter(pickable);

  useEffect(() => { if (open) { setActive(-1); requestAnimationFrame(() => inputRef.current?.focus()); } }, [open]);
  useEffect(() => { setActive(-1); }, [q]);
  // A click outside closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = x => {
    if (!pickable(x)) return;
    onChange?.(x.id, { qualified: fits(x) === 'all', fit: fits(x), tech: x });
    setOpen(false); setQ('');
    requestAnimationFrame(() => btnRef.current?.focus());
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btnRef.current?.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!enabled.length) return;
      const cur = enabled.indexOf(flat[active]);
      const next = e.key === 'ArrowDown' ? Math.min(enabled.length - 1, cur + 1) : Math.max(0, cur - 1);
      setActive(flat.indexOf(enabled[next]));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const x = flat[active] && pickable(flat[active]) ? flat[active] : enabled[0];
      if (x) choose(x);
    }
  };

  let i = -1;
  const row = x => {
    i += 1;
    const idx = i;
    const fit = fits(x);
    const can = pickable(x);
    const own = preferTeamId && Number(x.team_leader_id) === Number(preferTeamId);
    const meta = [
      x.state !== 'busy' && Number(x.open_jobs) > 0 && (Number(x.open_jobs) === 1 ? t('techPicker.open_jobs_one', '1 open job')
        : t('techPicker.open_jobs_n', '{{n}} open jobs', { n: Number(x.open_jobs) })),
      Number(x.booked_min_today) > 0 && t('techPicker.booked_today', '{{time}} booked today', { time: fmtMinutes(x.booked_min_today) }),
      Number(x.worked_min_today) > 0 && t('techPicker.worked_today', '{{time}} worked today', { time: fmtMinutes(x.worked_min_today) }),
      x.team_leader_name && !own && t('techPicker.team_of', "{{name}}'s team", { name: shortName(x.team_leader_name) }),
      !x.team_leader_name && t('techPicker.no_team', 'No team'),
    ].filter(Boolean);
    return (
      <li key={x.id} id={`${uid}-o${x.id}`} role="option" data-i={idx} aria-selected={Number(x.id) === Number(value)} aria-disabled={!can || undefined}
        className={`tp-opt${idx === active ? ' is-active' : ''}${Number(x.id) === Number(value) ? ' is-on' : ''}${can ? '' : ' is-off'}`}
        onMouseMove={() => can && active !== idx && setActive(idx)} onClick={() => choose(x)}>
        <span className="tp-av" style={{ background: AVATAR_BG[Math.abs(Number(x.id)) % 6] }} aria-hidden="true">{initials(x.full_name)}</span>
        <span className="tp-body">
          <span className="tp-name">
            <b>{x.full_name}</b>
            {own && mixedTeams && <span className="tp-chip navy">{t('techPicker.my_team', 'Team')}</span>}
            {Number(x.id) === Number(currentId) && <span className="tp-chip">{t('techPicker.now', 'Now')}</span>}
          </span>
          <span className="tp-meta">
            <StateBadge tech={x} />
            {meta.map((m, k) => <span key={k}>· {m}</span>)}
          </span>
        </span>
        <span className={`tp-fit is-${fit}`}>
          {fit === 'all' ? <><Check width={13} height={13} /> {types.length ? t('techPicker.qualified', 'Qualified') : ''}</>
            : fit === 'some' ? t('techPicker.some_jobs', 'Some jobs')
              : <><WarningTriangle width={13} height={13} /> {x.skills === null ? t('techPicker.no_skills', 'No skills recorded') : t('techPicker.not_qualified', 'Not qualified')}</>}
        </span>
      </li>
    );
  };

  const hiddenOthers = !othersOpen ? none.length : 0;
  const listId = `${uid}-list`;
  return (
    <div className={`tp${open ? ' is-open' : ''}`} ref={rootRef}>
      <button ref={btnRef} type="button" className={`tp-trigger${selected ? ' has-value' : ''}`} disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-label={label}
        onClick={() => setOpen(o => !o)}>
        {selected ? (
          <>
            <span className="tp-av sm" style={{ background: AVATAR_BG[Math.abs(Number(selected.id)) % 6] }} aria-hidden="true">{initials(selected.full_name)}</span>
            <span className="tp-trigger-body">
              <b>{selected.full_name}</b>
              <StateBadge tech={selected} />
            </span>
            {fits(selected) !== 'all' && <span className={`tp-fit is-${fits(selected)}`}><WarningTriangle width={13} height={13} /></span>}
          </>
        ) : <span className="tp-ph">{placeholder || t('techPicker.choose', 'Choose a technician…')}</span>}
        <NavArrowDown width={15} height={15} className="tp-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="tp-panel" onKeyDown={onKey}>
          <div className="tp-search">
            <Search width={14} height={14} aria-hidden="true" />
            <input ref={inputRef} type="search" value={q} autoComplete="off" role="combobox" aria-expanded="true"
              aria-controls={listId} aria-activedescendant={active >= 0 && flat[active] ? `${uid}-o${flat[active].id}` : undefined}
              aria-label={t('techPicker.search', 'Search technicians')} placeholder={t('techPicker.search', 'Search technicians')}
              onChange={e => setQ(e.target.value)} />
            {q && <button type="button" className="tp-clear" aria-label={t('techPicker.clear', 'Clear')} onClick={() => { setQ(''); inputRef.current?.focus(); }}><Xmark width={13} height={13} /></button>}
          </div>
          <ul className="tp-list" role="listbox" id={listId} ref={listRef} aria-label={label || t('techPicker.technicians', 'Technicians')}>
            {groups.map(g => (
              <li key={g.key} role="presentation" className="tp-group">
                <div className="tp-group-h" role="presentation">{g.title} <span>{g.items.length}</span></div>
                <ul role="group" aria-label={g.title}>{g.items.map(row)}</ul>
              </li>
            ))}
            {!flat.length && (
              <li className="tp-empty" role="presentation">
                {needle ? t('techPicker.no_match', 'No technician matches “{{q}}”.', { q: q.trim() })
                  : !technicians.length ? t('techPicker.none', 'No technicians to offer.')
                    : t('techPicker.none_qualified', 'Nobody is qualified for {{type}} yet — tick their skills on the Technicians page, or ask a manager.', { type: typeText })}
              </li>
            )}
          </ul>
          {hiddenOthers > 0 && (
            <button type="button" className="tp-more" onClick={() => setShowOthers(true)}>
              {t('techPicker.show_not_qualified', 'Show {{n}} not qualified', { n: hiddenOthers })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
