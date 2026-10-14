/**
 * BoardList — the Vehicle Status Board as a table: one row per car, sortable,
 * 50 rows a page. Clicking a row opens the side panel; the last column opens
 * the job card, copies the customer's link or starts a WhatsApp message.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, OpenNewWindow, Whatsapp, NavArrowUp, NavArrowDown, NavArrowLeft, NavArrowRight } from 'iconoir-react';
import {
  PHASES, ageTone, badgeText, boardOrder, classChip, fmtAge, fmtWhen, money, phaseBg, phaseColor, phaseLabel, plainName, toneOf, whoLabel,
} from './board';

const PAGE = 50;

const SORTS = {
  job: i => i.work_order_number || '',
  vehicle: i => i.plate || '',
  customer: i => (i.customer_name || '').toLowerCase(),
  step: i => PHASES.indexOf(i.phase) * 10 + (i.step || 0),
  waiting: i => i.waiting_on?.label || '',
  tech: i => (i.technician?.name || '').toLowerCase(),
  since: i => i.age_minutes,
  expected: i => i.expected_ready_at || '',
  payment: i => (i.invoice ? i.invoice.balance : -1),
};

export default function BoardList({ items, lateMinutes, onOpen, actions, currency, selectedId }) {
  const { t } = useTranslation();
  // No sort picked: the board's own order (jobs on job cards first, by step, oldest first).
  const [sort, setSort] = useState({ key: null, dir: 'desc' });
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort.key) return [...items].sort(boardOrder);
    const get = SORTS[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const x = get(a), y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || a.id - b.id;
    });
  }, [items, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const rows = sorted.slice((page - 1) * PAGE, page * PAGE);

  const head = (key, label) => {
    const on = sort.key === key;
    return (
      <th scope="col" aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="vsb-th-btn" onClick={() => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
          {label}
          {on && (sort.dir === 'asc' ? <NavArrowUp width={14} height={14} /> : <NavArrowDown width={14} height={14} />)}
        </button>
      </th>
    );
  };

  const payment = i => {
    const inv = i.invoice;
    if (!inv) return <span className="vsb-muted">{t('vehicleBoard.pay.none', 'No invoice')}</span>;
    if (inv.status === 'paid' || inv.balance <= 0) return <span className="vsb-pay is-paid">{t('vehicleBoard.pay.paid', 'Paid')}</span>;
    if (inv.on_account) return <span className="vsb-pay is-account">{t('vehicleBoard.pay.on_account', 'On account')}</span>;
    return <span className="vsb-pay is-due">{t('vehicleBoard.pay.unpaid', 'Unpaid {{amount}}', { amount: money(inv.balance, currency) })}</span>;
  };

  return (
    <div className="vsb-list">
      <div className="vsb-table-wrap">
        <table className="vsb-table">
          <thead>
            <tr>
              {head('job', t('vehicleBoard.col.job', 'Job'))}
              {head('vehicle', t('vehicleBoard.col.vehicle', 'Vehicle'))}
              {head('customer', t('vehicleBoard.col.customer', 'Customer'))}
              {head('step', t('vehicleBoard.col.step', 'Step'))}
              {head('waiting', t('vehicleBoard.col.waiting_on', 'Waiting on'))}
              {head('tech', t('vehicleBoard.col.technician', 'Technician'))}
              {head('since', t('vehicleBoard.col.since', 'In step since'))}
              {head('expected', t('vehicleBoard.col.expected', 'Expected ready'))}
              {head('payment', t('vehicleBoard.col.payment', 'Payment'))}
              <th scope="col"><span className="vsb-sr">{t('vehicleBoard.col.actions', 'Actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(i => {
              const chip = classChip(t, i);
              const sub = i.sub_status ? i.badges[0] : null;
              const tone = ageTone(i, lateMinutes);
              return (
                <tr key={i.id} className={selectedId === i.id ? 'is-selected' : ''} onClick={() => onOpen(i)}>
                  <td>
                    <button type="button" className="vsb-row-link" onClick={e => { e.stopPropagation(); onOpen(i); }} dir="ltr">
                      {i.work_order_number}
                    </button>
                    <div className="vsb-muted vsb-small" dir="ltr">
                      {i.main_job_card_number || '—'}{i.sub_cards > 0 ? ` · ${t('vehicleBoard.sub_n', '+{{n}} sub', { n: i.sub_cards })}` : ''}
                    </div>
                  </td>
                  <td>
                    <span className="vsb-strong" dir="ltr">{i.plate || '—'}</span>
                    <div className="vsb-muted vsb-small">{[i.make, i.model, i.year].filter(Boolean).join(' ')}</div>
                  </td>
                  <td>
                    <div>{i.customer_name || '—'}</div>
                    {chip && <span className="vsb-class-chip">{chip}</span>}
                    {i.customer_phone && <div className="vsb-muted vsb-small" dir="ltr">{i.customer_phone}</div>}
                  </td>
                  <td>
                    <span className="vsb-step-pill" style={{ background: phaseBg(i.phase), color: phaseColor(i.phase) }}>{i.step} · {phaseLabel(t, i.phase)}</span>
                    {sub && <div><span className="vsb-badge" style={{ background: toneOf(sub.tone).bg, color: toneOf(sub.tone).color }}>{badgeText(t, sub)}</span></div>}
                  </td>
                  <td>{i.waiting_on ? whoLabel(t, i.waiting_on.key) : '—'}</td>
                  <td>{i.technician?.name ? plainName(i.technician.name) : <span className="vsb-muted">{t('vehicleBoard.no_tech', 'No technician')}</span>}</td>
                  <td>
                    <span className={`vsb-age is-${tone}`}>{fmtAge(i.age_minutes)}</span>
                    <div className="vsb-muted vsb-small">{fmtWhen(i.phase_since)}</div>
                  </td>
                  <td>{i.expected_ready_at ? fmtWhen(i.expected_ready_at) : <span className="vsb-muted">—</span>}</td>
                  <td>{payment(i)}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="vsb-row-actions">
                      <button type="button" className="vsb-icon-btn is-outline" onClick={() => actions.open(i)} aria-label={t('vehicleBoard.act.open', 'Open job card')} title={t('vehicleBoard.act.open', 'Open job card')}>
                        <OpenNewWindow width={16} height={16} />
                      </button>
                      {actions.canLink(i) && (
                        <button type="button" className="vsb-icon-btn is-outline" onClick={() => actions.copyLink(i)} aria-label={t('vehicleBoard.act.copy_link', 'Copy customer link')} title={t('vehicleBoard.act.copy_link', 'Copy customer link')}>
                          <Copy width={16} height={16} />
                        </button>
                      )}
                      {actions.canWhatsApp(i) && (
                        <button type="button" className="vsb-icon-btn is-outline is-wa" onClick={() => actions.whatsapp(i)} aria-label={t('vehicleBoard.act.whatsapp', 'WhatsApp')} title={t('vehicleBoard.act.whatsapp', 'WhatsApp')}>
                          <Whatsapp width={16} height={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="vsb-pager" aria-label={t('vehicleBoard.pages', 'Pages')}>
          <button type="button" className="vsb-icon-btn is-outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label={t('vehicleBoard.prev', 'Previous page')}>
            <NavArrowLeft width={18} height={18} className="vsb-flip" />
          </button>
          <span>{t('vehicleBoard.page_of', 'Page {{page}} of {{pages}} · {{n}} cars', { page, pages, n: sorted.length })}</span>
          <button type="button" className="vsb-icon-btn is-outline" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label={t('vehicleBoard.next_page', 'Next page')}>
            <NavArrowRight width={18} height={18} className="vsb-flip" />
          </button>
        </nav>
      )}
    </div>
  );
}
