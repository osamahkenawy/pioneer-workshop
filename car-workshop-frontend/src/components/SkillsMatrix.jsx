/**
 * SkillsMatrix — the user-to-skill mapping on one screen (client feedback
 * 18 Nov 2026, point 8; meeting of 3 Nov, point 16): every active technician
 * against every service type, ticked in one go. A job with a service type is
 * given to a technician qualified for it; until this is filled in, every
 * assignment needed a reason.
 *
 * Saves only the technicians whose ticks changed (PATCH /mechanics/:id/skills).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Xmark, Check, Search } from 'iconoir-react';
import api from '../lib/api';
import { JOB_TYPES } from '../lib/intakeOptions';
import './SkillsMatrix.css';

const keyOf = list => JSON.stringify(JOB_TYPES.map(o => o.value).filter(k => (list || []).includes(k)));

export default function SkillsMatrix({ technicians, canEdit, onClose, onSaved }) {
  const { t } = useTranslation();
  const active = useMemo(() => technicians.filter(m => m.is_active !== 0 && m.is_active !== false), [technicians]);
  const [ticks, setTicks] = useState(() => Object.fromEntries(active.map(m => [m.id, m.skills || []])));
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const changed = active.filter(m => keyOf(ticks[m.id]) !== keyOf(m.skills) || (m.skills == null && (ticks[m.id] || []).length));
  const shown = active.filter(m => !q.trim() || String(m.full_name || '').toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id, k) => setTicks(s => {
    const cur = s[id] || [];
    return { ...s, [id]: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k] };
  });
  const column = k => {
    const all = shown.every(m => (ticks[m.id] || []).includes(k));
    setTicks(s => {
      const next = { ...s };
      for (const m of shown) {
        const cur = next[m.id] || [];
        next[m.id] = all ? cur.filter(x => x !== k) : (cur.includes(k) ? cur : [...cur, k]);
      }
      return next;
    });
  };
  const counts = Object.fromEntries(JOB_TYPES.map(o => [o.value, active.filter(m => (ticks[m.id] || []).includes(o.value)).length]));
  const unmapped = active.filter(m => !(ticks[m.id] || []).length).length;

  const save = async () => {
    if (!changed.length) return;
    setBusy(true); setMsg(null);
    const saved = {}, failed = [];
    for (const m of changed) {
      const r = await api.patch(`/mechanics/${m.id}/skills`, { skills: ticks[m.id] || [] }).catch(() => null);
      if (r?.success) saved[m.id] = r.data?.skills ?? ticks[m.id];
      else failed.push(m.full_name);
    }
    setBusy(false);
    onSaved(saved);
    setMsg(failed.length
      ? { ok: false, text: t('skillsMatrix.failed', 'Could not save: {{list}}.', { list: failed.join(', ') }) }
      : { ok: true, text: t('skillsMatrix.saved', 'Skills saved for {{n}} technician(s).', { n: Object.keys(saved).length }) });
  };

  return (
    <div className="sm-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="sm-dialog" role="dialog" aria-modal="true" aria-labelledby="sm-title">
        <header className="sm-head">
          <div>
            <h3 id="sm-title">{t('skillsMatrix.title', 'Skills — who does which service type')}</h3>
            <p>{t('skillsMatrix.sub', 'A job is given to a technician who has its service type ticked. Tick everyone once; changes apply to the next assignment.')}</p>
          </div>
          <button type="button" className="sm-x" onClick={onClose} disabled={busy} aria-label={t('common.close', 'Close')}><Xmark width={18} height={18} /></button>
        </header>
        <div className="sm-tools">
          <label className="sm-search">
            <Search width={15} height={15} aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('skillsMatrix.search', 'Find a technician…')} aria-label={t('skillsMatrix.search', 'Find a technician…')} />
          </label>
          <span className={`sm-badge${unmapped ? ' warn' : ''}`}>
            {unmapped
              ? t('skillsMatrix.unmapped', '{{n}} of {{total}} without any skill', { n: unmapped, total: active.length })
              : t('skillsMatrix.all_mapped', 'Every technician has at least one skill')}
          </span>
        </div>
        <div className="sm-scroll">
          <table className="sm-table">
            <thead>
              <tr>
                <th scope="col">{t('skillsMatrix.technician', 'Technician')}</th>
                {JOB_TYPES.map(o => (
                  <th key={o.value} scope="col">
                    {canEdit ? (
                      <button type="button" className="sm-col" onClick={() => column(o.value)} title={t('skillsMatrix.col_hint', 'Tick or clear the whole column')}>
                        {t(`jobTasks.type.${o.value}`, o.label)}
                      </button>
                    ) : t(`jobTasks.type.${o.value}`, o.label)}
                    <span className="sm-count">{counts[o.value]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(m => {
                const dirty = changed.includes(m);
                return (
                  <tr key={m.id} className={dirty ? 'is-dirty' : undefined}>
                    <th scope="row">
                      <span className="sm-name">{m.full_name}</span>
                      {m.specialization && <span className="sm-spec">{m.specialization}</span>}
                    </th>
                    {JOB_TYPES.map(o => (
                      <td key={o.value}>
                        <input type="checkbox" checked={(ticks[m.id] || []).includes(o.value)} disabled={!canEdit || busy}
                          onChange={() => toggle(m.id, o.value)}
                          aria-label={`${m.full_name}: ${t(`jobTasks.type.${o.value}`, o.label)}`} />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!shown.length && (
                <tr><td colSpan={JOB_TYPES.length + 1} className="sm-empty">{t('skillsMatrix.none', 'No technicians match.')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="sm-foot">
          {msg && <span className={msg.ok ? 'sm-ok' : 'sm-bad'} role="status">{msg.text}</span>}
          <button type="button" className="module-btn module-btn-outline" onClick={onClose} disabled={busy}>{t('common.close', 'Close')}</button>
          {canEdit && (
            <button type="button" className="module-btn module-btn-primary" onClick={save} disabled={busy || !changed.length}>
              <Check width={15} height={15} /> {busy ? t('skillsMatrix.saving', 'Saving…')
                : changed.length ? t('skillsMatrix.save_n', 'Save {{n}} change(s)', { n: changed.length }) : t('skillsMatrix.no_changes', 'No changes')}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
