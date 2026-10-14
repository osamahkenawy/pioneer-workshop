/**
 * BoardDrawer — the side panel for one car on the Vehicle Status Board
 * (480px from the inline end; full screen on a phone).
 *
 * It reads what the job card screen reads — GET /api/workflow/work-orders/:id
 * (steps, next, job cards, estimate, parts, QC, invoice, contacts, gate pass)
 * and GET /api/work-orders/:id (vehicle details and the status history) — and
 * changes nothing. Sections: where it is · customer · vehicle & reported issue
 * · estimate · job cards & technicians · parts · quality check · collection &
 * payment · history. Actions: open the job card, copy / SMS / WhatsApp the
 * customer's status link, print the job sheet.
 */
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Xmark, OpenNewWindow, Copy, ChatBubble, Printer, Phone, MoreHoriz, Refresh, Wrench, Package, ShieldCheck,
  Page, User, Car, Clock, CreditCard, Whatsapp,
} from 'iconoir-react';
import api from '../../lib/api';
import { AuthContext } from '../../context/AuthContext';
import { jcLabel, jcTone, timeStateLabel, woLabel, woTone } from '../../lib/statusLabels';
import PhaseStepper from './PhaseStepper';
import {
  badgeText, classChip, deptLabel, fmtAge, fmtDay, fmtWhen, jobLine, money, phaseColor, phaseBg, phaseLabel, plainName, toneOf,
  vehicleLine,
} from './board';

const EST_EN = {
  draft: 'Draft', sent_to_customer: 'Sent to customer', partially_approved: 'Partly approved', approved: 'Approved',
  rejected: 'Declined', expired: 'Expired', converted: 'Approved — on the job card',
};
const INV_EN = { draft: 'Draft', sent: 'Unpaid', paid: 'Paid', partially_paid: 'Part paid', overdue: 'Overdue' };
const CHANNEL_EN = { phone: 'Phone', whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS' };
const OUTCOME_EN = { reached: 'Reached', no_answer: 'No answer', message_sent: 'Message sent' };
const FORMAT_EN = { genuine: 'Genuine', after_market: 'After-Market', both: 'Genuine & After-Market' };
const QC_EN = { issue_repaired: 'Vehicle issue has been repaired correctly', test_drive: 'Test drive', other_issues: 'Any other issues or comments' };

const fmtMinutes = m => fmtAge(m);
const items = v => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

function Section({ icon: Icon, title, children }) {
  return (
    <section className="vsb-dsec">
      <h3 className="vsb-dsec-title">{Icon && <Icon width={15} height={15} aria-hidden="true" />}{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, children, wide }) {
  return (
    <div className={`vsb-fact${wide ? ' is-wide' : ''}`}>
      <div className="vsb-fact-label">{label}</div>
      <div className="vsb-fact-value">{children ?? '—'}</div>
    </div>
  );
}

const Chip = ({ tone, children }) => {
  const c = toneOf(tone);
  return <span className="vsb-badge" style={{ background: c.bg, color: c.color }}>{children}</span>;
};

/**
 * @param {object} props
 * @param {object} props.item       the board item (what is shown before the details load)
 * @param {boolean} props.sheet     full-screen phone sheet with a bottom bar
 * @param {Function} props.onClose
 * @param {object} props.actions    useBoardActions()
 */
export default function BoardDrawer({ item, sheet = false, onClose, actions }) {
  const { t } = useTranslation();
  const { workshop } = useContext(AuthContext) || {};
  const currency = workshop?.currency || 'AED';
  const [wf, setWf] = useState(null);
  const [wo, setWo] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useRef(null);
  const panelRef = useRef(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [a, b] = await Promise.all([api.get(`/workflow/work-orders/${item.id}`), api.get(`/work-orders/${item.id}`)]);
      if (!a?.success) throw new Error(a?.message || 'workflow');
      setWf(a.data);
      setWo(b?.success ? b.data : null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [item.id]);

  useEffect(() => { setWf(null); setWo(null); setMenuOpen(false); load(); }, [load]);

  // Esc closes (the menu first); focus starts on the close button.
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (menuOpenRef.current) setMenuOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A tap outside the ⋯ menu closes it.
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = e => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  // Keep Tab inside the panel while it is open.
  const onKeyDownTrap = e => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = panelRef.current.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const w = wf?.work_order || {};
  const cards = wf?.job_cards || [];
  const est = wf?.estimate || null;
  const inv = wf?.invoice || null;
  const contact = wf?.contacts?.[0] || null;
  const gate = wf?.gate_pass || null;
  const logs = (wo?.status_logs || []).filter((l, i, all) => i === 0 || l.status !== all[i - 1].status);
  const parts = cards.flatMap(c => (c.parts || []).map(p => ({ ...p, card: c.job_card_number })));
  const chip = classChip(t, item);
  const canLink = actions.canLink(item);
  const canWa = actions.canWhatsApp(item);
  const phoneDigits = String(item.customer_phone || '').replace(/[^\d+]/g, '');

  const partAnswer = p => {
    if (Number(p.quantity_issued) >= Number(p.quantity_requested) || p.status === 'issued') return [t('vehicleBoard.drawer.part_issued', 'Issued'), 'green'];
    if (p.availability === 'not_available') {
      return [p.expected_date ? t('vehicleBoard.drawer.part_expected', 'Expected {{date}}', { date: fmtDay(p.expected_date) })
        : t('vehicleBoard.drawer.part_not_available', 'Not on the shelf'), 'amber'];
    }
    return [t('vehicleBoard.drawer.part_unchecked', 'Store to check'), 'slate'];
  };

  const actionButtons = [
    canLink && { key: 'copy', icon: Copy, label: t('vehicleBoard.act.copy_link', 'Copy customer link'), run: () => actions.copyLink(item) },
    canLink && phoneDigits && { key: 'sms', icon: ChatBubble, label: t('vehicleBoard.act.sms', 'Send link by SMS'), run: () => actions.sms(item) },
    canWa && { key: 'wa', icon: Whatsapp, label: t('vehicleBoard.act.whatsapp', 'WhatsApp'), run: () => actions.whatsapp(item) },
    { key: 'print', icon: Printer, label: t('vehicleBoard.act.print', 'Print job sheet'), run: () => actions.print(item) },
  ].filter(Boolean);

  const titleId = `vsb-drawer-title-${item.id}`;
  const wtone = woTone(item);

  return (
    <>
      <div className="vsb-overlay" onClick={onClose} aria-hidden="true" />
      <aside ref={panelRef} className={`vsb-drawer${sheet ? ' is-sheet' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={onKeyDownTrap}>
        <header className="vsb-drawer-head">
          <div className="vsb-drawer-head-main">
            <div className="vsb-drawer-plate-row">
              <span className="vsb-plate is-lg" dir="ltr" id={titleId}>{item.plate || item.work_order_number}</span>
              <span className="vsb-step-pill" style={{ background: phaseBg(item.phase), color: phaseColor(item.phase) }}>
                {item.step} · {phaseLabel(t, item.phase)}
              </span>
            </div>
            {vehicleLine(item) && <div className="vsb-drawer-sub">{vehicleLine(item)}</div>}
            <div className="vsb-drawer-sub is-mono" dir="ltr">{jobLine(item)}</div>
          </div>
          <button ref={closeRef} type="button" className="vsb-icon-btn" onClick={onClose} aria-label={t('vehicleBoard.drawer.close', 'Close')}>
            <Xmark width={20} height={20} />
          </button>
        </header>

        <div className="vsb-drawer-body">
          {state === 'loading' && <div className="vsb-drawer-state"><span className="vsb-spinner" aria-hidden="true" />{t('vehicleBoard.loading', 'Loading…')}</div>}
          {state === 'error' && (
            <div className="vsb-drawer-state is-error">
              <p>{t('vehicleBoard.drawer.error', "Couldn't load this job.")}</p>
              <button type="button" className="vsb-btn" onClick={load}><Refresh width={16} height={16} /> {t('vehicleBoard.retry', 'Retry')}</button>
            </div>
          )}
          {state === 'ready' && wf && (
            <>
              {/* 1. Where it is */}
              <Section icon={Clock} title={t('vehicleBoard.drawer.where', 'Where it is')}>
                {wf.legacy ? (
                  <p className="vsb-muted">{t('vehicleBoard.drawer.legacy', 'Imported from the old system — this job was never worked on job cards.')}</p>
                ) : (
                  <PhaseStepper steps={wf.steps} currentStep={wf.current_step} next={wf.next} />
                )}
                <div className="vsb-drawer-chips">
                  <span className="vsb-badge" style={{ background: wtone.bg, color: wtone.color }}>{woLabel(t, { status: w.status || item.status, customer_approved_at: w.customer_approved_at })}</span>
                  {item.badges.map(b => <Chip key={b.key} tone={b.tone}>{badgeText(t, b)}</Chip>)}
                </div>
                <div className="vsb-muted vsb-small">
                  {t('vehicleBoard.drawer.in_step_for', 'In this step for {{age}}', { age: fmtAge(item.age_minutes) })}
                  {item.expected_ready_at && <> · {t('vehicleBoard.drawer.expected', 'Expected ready {{when}}', { when: fmtWhen(item.expected_ready_at) })}</>}
                </div>
              </Section>

              {/* 2. Customer */}
              <Section icon={User} title={t('vehicleBoard.drawer.customer', 'Customer')}>
                <div className="vsb-customer-row">
                  <div className="vsb-customer-main">
                    <div className="vsb-strong">{w.customer_name || item.customer_name || '—'}</div>
                    {item.customer_phone && <div className="vsb-muted" dir="ltr">{item.customer_phone}</div>}
                    {chip && <span className="vsb-class-chip">{chip}</span>}
                  </div>
                  <div className="vsb-customer-actions">
                    {phoneDigits && (
                      <a className="vsb-icon-btn is-outline" href={`tel:${phoneDigits}`} aria-label={t('vehicleBoard.drawer.call', 'Call')}><Phone width={18} height={18} /></a>
                    )}
                    {canWa && (
                      <button type="button" className="vsb-icon-btn is-outline is-wa" onClick={() => actions.whatsapp(item)} aria-label={t('vehicleBoard.act.whatsapp', 'WhatsApp')}>
                        <Whatsapp width={18} height={18} />
                      </button>
                    )}
                  </div>
                </div>
              </Section>

              {/* 3. Vehicle & reported issue */}
              <Section icon={Car} title={t('vehicleBoard.drawer.vehicle', 'Vehicle & reported issue')}>
                <div className="vsb-facts">
                  <Fact label={t('vehicleBoard.drawer.plate', 'Plate')}><span dir="ltr">{item.plate || '—'}</span></Fact>
                  <Fact label={t('vehicleBoard.drawer.vehicle_model', 'Vehicle')}>{[item.make, item.model, item.year].filter(Boolean).join(' ') || '—'}</Fact>
                  <Fact label={t('vehicleBoard.drawer.colour', 'Colour')}>{item.colour || wo?.vehicle_color || '—'}</Fact>
                  <Fact label={t('vehicleBoard.drawer.odometer', 'Odometer in')}>{w.odometer_in != null ? `${Number(w.odometer_in).toLocaleString('en')} km` : '—'}</Fact>
                  <Fact label={t('vehicleBoard.drawer.vin', 'VIN')} wide><span dir="ltr" className="is-mono">{w.vin || item.vin || '—'}</span></Fact>
                  <Fact label={t('vehicleBoard.drawer.issue', 'Reported issue')} wide>{w.description ? <span className="vsb-prewrap">{w.description}</span> : '—'}</Fact>
                </div>
              </Section>

              {/* 4. Estimate */}
              <Section icon={Page} title={t('vehicleBoard.drawer.estimate', 'Estimate')}>
                {est ? (
                  <div className="vsb-facts">
                    <Fact label={t('vehicleBoard.drawer.est_number', 'Number')}><span dir="ltr">{est.estimate_number}</span></Fact>
                    <Fact label={t('vehicleBoard.drawer.est_status', 'Status')}>{t(`vehicleBoard.est.${est.status}`, EST_EN[est.status] || est.status)}</Fact>
                    {est.pricing && <Fact label={t('vehicleBoard.drawer.genuine', 'Genuine')}>{money(est.pricing.total_genuine, currency)}</Fact>}
                    {est.pricing && <Fact label={t('vehicleBoard.drawer.after_market', 'After-Market')}>{money(est.pricing.total_after_market, currency)}</Fact>}
                    <Fact label={t('vehicleBoard.drawer.sent', 'Sent')}>
                      {est.sent_to_customer_at
                        ? `${fmtWhen(est.sent_to_customer_at)}${est.estimate_format ? ` · ${t(`vehicleBoard.format.${est.estimate_format}`, FORMAT_EN[est.estimate_format])}` : ''}`
                        : t('vehicleBoard.drawer.not_sent', 'Not sent')}
                    </Fact>
                    <Fact label={t('vehicleBoard.drawer.decision', 'Decision')}>
                      {est.status === 'rejected' ? t('vehicleBoard.est.rejected', 'Declined')
                        : est.customer_approved_at ? t('vehicleBoard.drawer.approved_on', 'Approved {{when}}', { when: fmtWhen(est.customer_approved_at) })
                        : w.customer_approved_at ? t('vehicleBoard.drawer.approved_on', 'Approved {{when}}', { when: fmtWhen(w.customer_approved_at) })
                        : t('vehicleBoard.drawer.waiting', 'Waiting')}
                    </Fact>
                  </div>
                ) : (
                  <p className="vsb-muted">
                    {Number(w.total_amount) > 0
                      ? t('vehicleBoard.drawer.priced_counter', 'Priced on the job card: {{amount}}', { amount: money(w.total_amount, currency) })
                      : t('vehicleBoard.drawer.no_estimate', 'No estimate yet.')}
                  </p>
                )}
              </Section>

              {/* 5. Job cards & technicians */}
              <Section icon={Wrench} title={t('vehicleBoard.drawer.job_cards', 'Job cards & technicians')}>
                {cards.length ? (
                  <ul className="vsb-jc-list">
                    {cards.map(c => {
                      const tone = jcTone(c.status);
                      return (
                        <li key={c.id} className="vsb-jc">
                          <div className="vsb-jc-top">
                            <span className="vsb-strong is-mono" dir="ltr">{c.job_card_number}</span>
                            <span className="vsb-badge" style={{ background: tone.bg, color: tone.color }}>{jcLabel(t, c.status)}</span>
                          </div>
                          <div className="vsb-muted vsb-small">
                            {c.parent_job_card_id ? t('vehicleBoard.drawer.sub_card', 'Sub-job card') : t('vehicleBoard.drawer.main_card', 'Main job card')}
                            {c.department ? ` · ${deptLabel(t, c.department)}` : ''}
                            {c.parent_job_card_id && c.title ? ` · ${c.title}` : ''}
                          </div>
                          <div className="vsb-jc-meta">
                            <span>{c.mechanic_name ? plainName(c.mechanic_name) : t('vehicleBoard.no_tech', 'No technician')}</span>
                            <span>{t('vehicleBoard.drawer.time_booked', 'Time booked: {{t}}', { t: fmtMinutes(c.time?.minutes || 0) })}</span>
                            {c.time?.state && c.time.state !== 'idle' && <span>{timeStateLabel(t, c.time.state)}</span>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="vsb-muted">{t('vehicleBoard.drawer.no_cards', 'No job card on this job.')}</p>
                )}
              </Section>

              {/* 6. Parts */}
              <Section icon={Package} title={t('vehicleBoard.drawer.parts', 'Parts')}>
                {parts.length ? (
                  <ul className="vsb-lines">
                    {parts.map(p => {
                      const [answer, tone] = partAnswer(p);
                      return (
                        <li key={p.id} className="vsb-line">
                          <span className="vsb-line-main">{Number(p.quantity_requested)} × {p.description}</span>
                          <Chip tone={tone}>{answer}</Chip>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="vsb-muted">{t('vehicleBoard.drawer.no_parts', 'No parts requested.')}</p>
                )}
              </Section>

              {/* 7. Quality check */}
              <Section icon={ShieldCheck} title={t('vehicleBoard.drawer.qc', 'Quality check')}>
                {cards.some(c => c.qc) ? (
                  <ul className="vsb-jc-list">
                    {cards.map(c => (
                      <li key={c.id} className="vsb-jc">
                        <div className="vsb-jc-top">
                          <span className="vsb-strong is-mono" dir="ltr">{c.job_card_number}</span>
                          {c.qc ? (
                            <Chip tone={c.qc.overall_result === 'failed' ? 'red' : 'green'}>
                              {c.qc.overall_result === 'failed' ? t('vehicleBoard.drawer.qc_failed', 'Failed') : t('vehicleBoard.drawer.qc_passed', 'Passed')}
                            </Chip>
                          ) : <span className="vsb-muted vsb-small">{t('vehicleBoard.qc_not_yet', 'Not yet')}</span>}
                        </div>
                        {c.qc && (
                          <ul className="vsb-qc-points">
                            {items(c.qc.checklist_items).map(p => (
                              <li key={p.key || p.item}>
                                <span className={`vsb-qc-mark ${p.key === 'other_issues' ? 'is-note' : p.passed ? 'is-pass' : 'is-fail'}`} aria-hidden="true" />
                                {t(`workflow.qc_item.${p.key}`, QC_EN[p.key] || p.item)}
                                {p.notes ? <span className="vsb-muted"> — {p.notes}</span> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="vsb-muted">{t('vehicleBoard.qc_not_yet', 'Not yet')}</p>
                )}
              </Section>

              {/* 8. Collection & payment */}
              <Section icon={CreditCard} title={t('vehicleBoard.drawer.collection', 'Collection & payment')}>
                <div className="vsb-facts">
                  <Fact label={t('vehicleBoard.drawer.last_contact', 'Last contact')} wide>
                    {contact
                      ? `${t(`vehicleBoard.channel.${contact.channel}`, CHANNEL_EN[contact.channel] || contact.channel)} · ${t(`vehicleBoard.outcome.${contact.outcome}`, OUTCOME_EN[contact.outcome] || contact.outcome || '')} · ${fmtWhen(contact.created_at)}${contact.contacted_by_name ? ` · ${contact.contacted_by_name}` : ''}`
                      : t('vehicleBoard.drawer.no_contact', 'Not called yet')}
                  </Fact>
                  <Fact label={t('vehicleBoard.drawer.invoice', 'Invoice')}>
                    {inv ? <><span dir="ltr">{inv.invoice_number}</span> · {t(`vehicleBoard.inv.${inv.status}`, INV_EN[inv.status] || inv.status)}</> : t('vehicleBoard.drawer.no_invoice', 'Not raised')}
                  </Fact>
                  <Fact label={t('vehicleBoard.drawer.balance', 'Balance')}>
                    {inv ? (item.invoice?.on_account && inv.status !== 'paid'
                      ? t('vehicleBoard.pay.on_account', 'On account')
                      : money(Math.max(0, Number(inv.total_amount || 0) - Number(inv.amount_paid || 0)), currency)) : '—'}
                  </Fact>
                  <Fact label={t('vehicleBoard.drawer.gate_pass', 'Gate pass')} wide>
                    {gate?.status === 'released'
                      ? <><span dir="ltr">{gate.gate_pass_number}</span> · {fmtWhen(gate.released_at)}</>
                      : t('vehicleBoard.drawer.no_gate_pass', 'Not issued')}
                  </Fact>
                </div>
              </Section>

              {/* 9. History */}
              <Section icon={Clock} title={t('vehicleBoard.drawer.history', 'History')}>
                {logs.length ? (
                  <ol className="vsb-history">
                    {logs.map(l => (
                      <li key={l.id}>
                        <span className="vsb-history-dot" aria-hidden="true" />
                        <span className="vsb-history-main">{woLabel(t, l.status)}</span>
                        <span className="vsb-muted vsb-small">{fmtWhen(l.created_at)}{l.changed_by_name ? ` · ${l.changed_by_name}` : ''}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="vsb-muted">{t('vehicleBoard.drawer.no_history', 'No history yet.')}</p>
                )}
              </Section>
            </>
          )}
        </div>

        <footer className="vsb-drawer-foot">
          <button type="button" className="vsb-btn is-primary" onClick={() => actions.open(item)}>
            <OpenNewWindow width={18} height={18} /> {t('vehicleBoard.act.open', 'Open job card')}
          </button>
          {sheet ? (
            <div className="vsb-menu-wrap" ref={menuRef}>
              <button type="button" className="vsb-icon-btn is-outline" aria-haspopup="menu" aria-expanded={menuOpen}
                aria-label={t('vehicleBoard.act.more', 'More actions')} onClick={() => setMenuOpen(o => !o)}>
                <MoreHoriz width={20} height={20} />
              </button>
              {menuOpen && (
                <div className="vsb-menu" role="menu">
                  {actionButtons.map(a => (
                    <button key={a.key} type="button" role="menuitem" className="vsb-menu-item" onClick={() => { setMenuOpen(false); a.run(); }}>
                      <a.icon width={18} height={18} /> {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="vsb-drawer-actions">
              {actionButtons.map(a => (
                <button key={a.key} type="button" className="vsb-btn" onClick={a.run}>
                  <a.icon width={16} height={16} /> {a.label}
                </button>
              ))}
            </div>
          )}
        </footer>
      </aside>
    </>
  );
}
