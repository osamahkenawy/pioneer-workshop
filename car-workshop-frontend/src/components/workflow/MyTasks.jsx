/**
 * MyTasks — "Your tasks": what is waiting on the logged-in person's role in
 * the Steps 1–7 workflow (GET /api/workflow/my-tasks). The Storekeeper sees
 * parts to price and issue, the Supervisor estimates to approve and quality
 * checks, the Team Leader technicians to assign and rework, the Service
 * Advisor physical inspections waiting for the customer's acknowledgement
 * (Step 3), estimates to raise/send and cars ready for collection (Step 7.2:
 * the collection call, payment, gate pass). Group titles come from the
 * server; the 'delivery' kind is that Step 7.2 group's internal key.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle, NavArrowRight, Refresh } from 'iconoir-react';
import api from '../../lib/api';
import './MyTasks.css';

const KIND_TONE = {
  price_parts: 'store', store: 'store', approve_estimate: 'approve', physical_inspection: 'advisor', raise_estimate: 'advisor', send_estimate: 'advisor',
  record_approval: 'advisor', convert_partial: 'advisor', delivery: 'good', assign: 'floor', assign_sub: 'floor', qc: 'approve', rework: 'bad',
};

export default function MyTasks() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const r = await api.get('/workflow/my-tasks'); if (r.success) setData(r.data); } catch { /* the dashboard still works without it */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i); }, []);

  if (!data && loading) return null;
  if (!data || !data.capabilities?.length) return null; // roles with no workflow part (e.g. customer)

  const total = data.groups.reduce((s, g) => s + g.total, 0);
  return (
    <section className="mt-card" aria-label={t('workflow.tasks.title', 'Your tasks')}>
      <header className="mt-head">
        <div>
          <h3>{t('workflow.tasks.title', 'Your tasks')} {total > 0 && <span className="mt-count">{total}</span>}</h3>
          <p>{t('workflow.tasks.sub', 'Job cards waiting on your part of the workflow')}</p>
        </div>
        <button className="mt-refresh" onClick={load} aria-label={t('workflow.refresh', 'Refresh')}><Refresh width={15} height={15} /></button>
      </header>
      {total === 0 ? (
        <div className="mt-empty"><CheckCircle width={18} height={18} /> {t('workflow.tasks.none', 'Nothing waiting on you right now.')}</div>
      ) : (
        <div className="mt-groups">
          {data.groups.map(g => (
            <div key={g.kind} className={`mt-group tone-${KIND_TONE[g.kind] || 'advisor'}`}>
              <div className="mt-group-head">
                <span>{t(`workflow.tasks.${g.kind}`, g.title)}</span>
                <b>{g.total}</b>
              </div>
              <ul>
                {g.items.slice(0, 5).map(it => (
                  <li key={`${g.kind}-${it.id}`}>
                    <Link to={it.link}>
                      <span className="mt-item-title">{it.title}</span>
                      <span className="mt-item-sub">{it.subtitle}</span>
                      <NavArrowRight width={14} height={14} />
                    </Link>
                  </li>
                ))}
              </ul>
              {g.total > 5 && <div className="mt-more">{t('workflow.tasks.more', '+{{n}} more', { n: g.total - 5 })}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
