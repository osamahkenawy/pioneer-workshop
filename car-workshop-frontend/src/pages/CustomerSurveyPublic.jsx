/**
 * Public customer feedback survey — CES / NPS / CSAT.
 *
 * Reached at /survey/:token (personalised link sent after a job) or /survey
 * (anonymous link / reception QR code). No login.
 *
 * The question wording lives in COPY below rather than the shared i18n files:
 * these are the exact approved survey strings, and a measurement instrument
 * only stays comparable over time if its wording is version-controlled in one
 * place next to the scoring logic — not edited as UI chrome.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import './CustomerSurveyPublic.css';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ── Question definitions ───────────────────────────────────────────────────
// `key` matches the API field exactly, so the payload needs no translation.
const SECTIONS = [
  {
    id: 'ces',
    badge: 'CES',
    questions: [
      { key: 'ces_find_channel', type: 'scale5', anchors: 'difficulty' },
      { key: 'ces_easy_handle',  type: 'scale5', anchors: 'agreement' },
      { key: 'resolution',       type: 'choice', options: ['yes', 'partially', 'no'] },
    ],
  },
  {
    id: 'nps',
    badge: 'NPS',
    questions: [
      { key: 'nps_score',  type: 'scale11', anchors: 'likelihood' },
      { key: 'nps_reason', type: 'text' },
    ],
  },
  {
    id: 'csat',
    badge: 'CSAT',
    questions: [
      { key: 'csat_overall',       type: 'scale5', anchors: 'agreement' },
      { key: 'csat_as_advertised', type: 'scale5', anchors: 'agreement' },
      { key: 'csat_expectations',  type: 'scale5', anchors: 'agreement' },
      { key: 'csat_rep_knowledge', type: 'scale5', anchors: 'satisfaction' },
      { key: 'csat_communication', type: 'scale5', anchors: 'quality' },
      { key: 'csat_response_time', type: 'scale5', anchors: 'quality' },
    ],
  },
];

// Every question is required except the free-text reason, which the design
// marks required too — so all 11 count toward the progress indicator.
const REQUIRED = SECTIONS.flatMap(s => s.questions.map(q => q.key));

const COPY = {
  en: {
    dir: 'ltr',
    brand: 'Pioneer',
    intro: 'Your feedback helps us improve. This short survey takes about 2 minutes and your answers are confidential.',
    switchTo: 'العربية',
    progress: (a, t) => `${a} of ${t} required questions answered`,
    sections: {
      ces:  { title: 'Effort & Ease',  sub: 'How easy was it to deal with us?' },
      nps:  { title: 'Recommendation', sub: 'Would you recommend Pioneer to others?' },
      csat: { title: 'Satisfaction',   sub: 'How satisfied are you with the service you received?' },
    },
    q: {
      ces_find_channel:   'How easy was it to find our customer service channel?',
      ces_easy_handle:    'Pioneer made it easy for me to handle my request.',
      resolution:         'Was your inquiry fully resolved / request handled?',
      nps_score:          'How likely are you to recommend Pioneer to your friends, relatives or colleagues?',
      nps_reason:         "What's the primary reason for your score?",
      csat_overall:       'Are you satisfied with your overall experience?',
      csat_as_advertised: 'I found the service exactly as advertised.',
      csat_expectations:  'The service received meets my expectations.',
      csat_rep_knowledge: "How satisfied are you with our customer service representative's knowledge?",
      csat_communication: 'How clear was the communication and information?',
      csat_response_time: 'How do you rate our response or processing time?',
    },
    anchors: {
      difficulty:   ['1 — Extremely difficult', '5 — Extremely easy'],
      agreement:    ['1 — Strongly disagree', '5 — Strongly agree'],
      satisfaction: ['1 — Extremely dissatisfied', '5 — Extremely satisfied'],
      quality:      ['1 — Very poor', '5 — Excellent'],
      likelihood:   ['0 — Very unlikely', '10 — Extremely likely'],
    },
    options: { yes: 'Yes', partially: 'Partially', no: 'No' },
    reasonPlaceholder: 'Tell us what drove your score…',
    yourDetails: 'Your details (optional)',
    namePlaceholder: 'Your name',
    phonePlaceholder: 'Mobile number',
    submit: 'Submit feedback',
    submitting: 'Submitting…',
    requiredHint: 'Required',
    errorMissing: 'Please answer the highlighted questions before submitting.',
    errorGeneric: 'Something went wrong. Please try again.',
    thanksTitle: 'Thank you for your feedback',
    thanksBody: 'Your responses have been recorded and go straight to our service team. We read every comment.',
    doneTitle: 'You have already completed this survey',
    doneBody: 'Thank you — we have your feedback for this visit. There is nothing more to do.',
    invalidTitle: 'This survey link is not valid',
    invalidBody: 'The link may have expired or been mistyped. Please contact us if you would still like to share your feedback.',
    loading: 'Loading survey…',
    forVisit: 'Visit',
    branch: 'Branch',
    service: 'Service',
  },
  ar: {
    dir: 'rtl',
    brand: 'بايونير',
    intro: 'ملاحظاتك تساعدنا على التحسين. يستغرق هذا الاستبيان القصير دقيقتين تقريبًا وإجاباتك سرية.',
    switchTo: 'English',
    progress: (a, t) => `تمت الإجابة على ${a} من ${t} سؤالًا مطلوبًا`,
    sections: {
      ces:  { title: 'سهولة التعامل', sub: 'ما مدى سهولة التعامل معنا؟' },
      nps:  { title: 'التوصية',        sub: 'هل توصي بـ بايونير للآخرين؟' },
      csat: { title: 'الرضا',          sub: 'ما مدى رضاك عن الخدمة التي تلقيتها؟' },
    },
    q: {
      ces_find_channel:   'ما مدى سهولة العثور على قناة خدمة العملاء لدينا؟',
      ces_easy_handle:    'سهّلت بايونير عليّ التعامل مع طلبي.',
      resolution:         'هل تم حل استفسارك / التعامل مع طلبك بالكامل؟',
      nps_score:          'ما مدى احتمالية أن توصي بـ بايونير لأصدقائك أو أقاربك أو زملائك؟',
      nps_reason:         'ما السبب الرئيسي لتقييمك؟',
      csat_overall:       'هل أنت راضٍ عن تجربتك بشكل عام؟',
      csat_as_advertised: 'وجدت الخدمة مطابقة تمامًا لما تم الإعلان عنه.',
      csat_expectations:  'الخدمة التي تلقيتها تلبي توقعاتي.',
      csat_rep_knowledge: 'ما مدى رضاك عن معرفة ممثل خدمة العملاء؟',
      csat_communication: 'ما مدى وضوح التواصل والمعلومات؟',
      csat_response_time: 'كيف تقيّم سرعة استجابتنا أو وقت المعالجة؟',
    },
    anchors: {
      difficulty:   ['١ — صعب للغاية', '٥ — سهل للغاية'],
      agreement:    ['١ — لا أوافق بشدة', '٥ — أوافق بشدة'],
      satisfaction: ['١ — غير راضٍ للغاية', '٥ — راضٍ للغاية'],
      quality:      ['١ — سيئ جدًا', '٥ — ممتاز'],
      likelihood:   ['٠ — غير مرجّح إطلاقًا', '١٠ — مرجّح للغاية'],
    },
    options: { yes: 'نعم', partially: 'جزئيًا', no: 'لا' },
    reasonPlaceholder: 'أخبرنا بما دفعك لهذا التقييم…',
    yourDetails: 'بياناتك (اختياري)',
    namePlaceholder: 'الاسم',
    phonePlaceholder: 'رقم الهاتف',
    submit: 'إرسال الملاحظات',
    submitting: 'جارٍ الإرسال…',
    requiredHint: 'مطلوب',
    errorMissing: 'يرجى الإجابة على الأسئلة المحددة قبل الإرسال.',
    errorGeneric: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
    thanksTitle: 'شكرًا لملاحظاتك',
    thanksBody: 'تم تسجيل إجاباتك وترسل مباشرة إلى فريق الخدمة لدينا. نقرأ كل تعليق.',
    doneTitle: 'لقد أكملت هذا الاستبيان بالفعل',
    doneBody: 'شكرًا لك — لدينا ملاحظاتك عن هذه الزيارة. لا يوجد المزيد لفعله.',
    invalidTitle: 'رابط الاستبيان غير صالح',
    invalidBody: 'قد يكون الرابط منتهي الصلاحية أو مكتوبًا بشكل خاطئ. يرجى التواصل معنا إذا كنت لا تزال ترغب في مشاركة ملاحظاتك.',
    loading: 'جارٍ تحميل الاستبيان…',
    forVisit: 'الزيارة',
    branch: 'الفرع',
    service: 'الخدمة',
  },
};

export default function CustomerSurveyPublic() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();

  const [lang, setLang]         = useState('en');
  const [answers, setAnswers]   = useState({});
  const [details, setDetails]   = useState({ contact_name: '', contact_phone: '' });
  const [context, setContext]   = useState(null);
  const [phase, setPhase]       = useState(token ? 'loading' : 'form');
  const [submitting, setSubmit] = useState(false);
  const [showErrors, setShow]   = useState(false);
  const [formError, setError]   = useState('');

  const t = COPY[lang];

  // ── Personalised links: load who this is for before showing the form ────
  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const res  = await fetch(`${API_BASE}/public/survey/${token}`);
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !json.success) { setPhase('invalid'); return; }
        setContext(json.data);
        setPhase(json.data.alreadyAnswered ? 'already' : 'form');
      } catch {
        if (alive) setPhase('invalid');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  // Keep the document direction in step with the chosen language so the whole
  // page mirrors, not just the text.
  useEffect(() => {
    document.documentElement.setAttribute('dir', t.dir);
    document.documentElement.setAttribute('lang', lang);
    return () => document.documentElement.setAttribute('dir', 'ltr');
  }, [lang, t.dir]);

  const setAnswer = useCallback((key, value) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  }, []);

  const answeredCount = useMemo(
    () => REQUIRED.filter(k => {
      const v = answers[k];
      return v !== undefined && v !== null && String(v).trim() !== '';
    }).length,
    [answers]
  );

  const missing = useMemo(
    () => REQUIRED.filter(k => {
      const v = answers[k];
      return v === undefined || v === null || String(v).trim() === '';
    }),
    [answers]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (missing.length) {
      setShow(true);
      setError(t.errorMissing);
      // Bring the first unanswered question into view rather than leaving the
      // customer to hunt for what is highlighted.
      document.getElementById(`q-${missing[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setSubmit(true);
    try {
      const payload = {
        ...answers,
        token: token || undefined,
        workshop: searchParams.get('workshop') || undefined,
        branch: searchParams.get('branch') || undefined,
        source: token ? 'link' : (searchParams.get('source') === 'qr' ? 'qr' : 'link'),
        language: lang,
        contact_name: details.contact_name || undefined,
        contact_phone: details.contact_phone || undefined,
      };
      const res  = await fetch(`${API_BASE}/public/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 409 && json.alreadyAnswered) { setPhase('already'); return; }
      if (!res.ok || !json.success) { setError(json.message || t.errorGeneric); return; }
      setPhase('thanks');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      setError(t.errorGeneric);
    } finally {
      setSubmit(false);
    }
  }

  const LangToggle = () => (
    <button type="button" className="svy-lang" onClick={() => setLang(l => (l === 'en' ? 'ar' : 'en'))}>
      {t.switchTo}
    </button>
  );

  // ── Terminal states ────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="svy-page" dir={t.dir}>
        <div className="svy-shell"><div className="svy-loading">{t.loading}</div></div>
      </div>
    );
  }

  if (phase === 'thanks' || phase === 'already' || phase === 'invalid') {
    const view = {
      thanks:  { mark: '✓', warn: false, title: t.thanksTitle,  body: t.thanksBody },
      already: { mark: '✓', warn: false, title: t.doneTitle,    body: t.doneBody },
      invalid: { mark: '!', warn: true,  title: t.invalidTitle, body: t.invalidBody },
    }[phase];
    return (
      <div className="svy-page" dir={t.dir}>
        <div className="svy-shell">
          <div className="svy-header" style={{ marginBottom: 18 }}>
            <LangToggle />
            <h1 className="svy-brand">{t.brand}</h1>
          </div>
          <div className="svy-final">
            <div className={`svy-final-mark${view.warn ? ' is-warn' : ''}`}>{view.mark}</div>
            <h2>{view.title}</h2>
            <p>{view.body}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── The form ───────────────────────────────────────────────────────────
  const renderQuestion = (q) => {
    const isMissing = showErrors && missing.includes(q.key);
    const label     = t.q[q.key];
    const anchors   = q.anchors ? t.anchors[q.anchors] : null;

    return (
      <div className={`svy-q${isMissing ? ' is-error' : ''}`} id={`q-${q.key}`} key={q.key}>
        <label className="svy-q-label" htmlFor={`f-${q.key}`}>
          {label}<span className="svy-req" aria-label={t.requiredHint}>*</span>
        </label>

        {(q.type === 'scale5' || q.type === 'scale11') && (
          <>
            <div
              className={`svy-scale${q.type === 'scale11' ? ' svy-scale-nps' : ''}`}
              role="radiogroup"
              aria-label={label}
            >
              {(q.type === 'scale11'
                ? Array.from({ length: 11 }, (_, i) => i)
                : [1, 2, 3, 4, 5]
              ).map(n => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={answers[q.key] === n}
                  className={`svy-scale-btn${answers[q.key] === n ? ' is-selected' : ''}`}
                  onClick={() => setAnswer(q.key, n)}
                >
                  {n}
                </button>
              ))}
            </div>
            {anchors && (
              <div className="svy-anchors"><span>{anchors[0]}</span><span>{anchors[1]}</span></div>
            )}
          </>
        )}

        {q.type === 'choice' && (
          <div className="svy-choices" role="radiogroup" aria-label={label}>
            {q.options.map(opt => (
              <button
                type="button"
                key={opt}
                role="radio"
                aria-checked={answers[q.key] === opt}
                className={`svy-scale-btn${answers[q.key] === opt ? ' is-selected' : ''}`}
                onClick={() => setAnswer(q.key, opt)}
              >
                {t.options[opt]}
              </button>
            ))}
          </div>
        )}

        {q.type === 'text' && (
          <textarea
            id={`f-${q.key}`}
            className="svy-textarea"
            placeholder={t.reasonPlaceholder}
            value={answers[q.key] || ''}
            onChange={e => setAnswer(q.key, e.target.value)}
          />
        )}

        {isMissing && <div className="svy-q-error">{t.requiredHint}</div>}
      </div>
    );
  };

  const pct = Math.round((answeredCount / REQUIRED.length) * 100);

  return (
    <div className="svy-page" dir={t.dir}>
      <div className="svy-shell">
        <header className="svy-header">
          <LangToggle />
          <img
            src="/assets/images/logos/pioneer/pioneer_logo_white.svg"
            alt="Pioneer Car Service Center"
            style={{ height: 64, width: 'auto', display: 'block', marginBottom: 12 }}
            onError={e => { e.target.style.display = 'none'; }}
          />
          <h1 className="svy-brand">{t.brand}</h1>
          <p className="svy-intro">{t.intro}</p>
          {context && (context.workOrderNumber || context.branch || context.service) && (
            <div className="svy-context">
              {context.workOrderNumber && <span>{t.forVisit}: {context.workOrderNumber}</span>}
              {context.branch  && <span>{t.branch}: {context.branch}</span>}
              {context.service && <span>{t.service}: {context.service}</span>}
            </div>
          )}
        </header>

        <div className="svy-progress-wrap">
          <div className="svy-progress-track">
            <div
              className="svy-progress-bar"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={answeredCount}
              aria-valuemin={0}
              aria-valuemax={REQUIRED.length}
            />
          </div>
          <div className="svy-progress-text">{t.progress(answeredCount, REQUIRED.length)}</div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {SECTIONS.map(section => (
            <section className="svy-section" key={section.id}>
              <div className="svy-section-head">
                <span className="svy-badge">{section.badge}</span>
                <h2 className="svy-section-title">{t.sections[section.id].title}</h2>
                <p className="svy-section-sub">{t.sections[section.id].sub}</p>
              </div>
              {section.questions.map(renderQuestion)}
            </section>
          ))}

          {/* Only shown on anonymous links — a personalised invite already
              knows who the customer is. */}
          {!token && (
            <section className="svy-section">
              <div className="svy-section-head">
                <h2 className="svy-section-title">{t.yourDetails}</h2>
              </div>
              <div className="svy-grid-2">
                <input
                  className="svy-input"
                  placeholder={t.namePlaceholder}
                  value={details.contact_name}
                  onChange={e => setDetails(d => ({ ...d, contact_name: e.target.value }))}
                />
                <input
                  className="svy-input"
                  placeholder={t.phonePlaceholder}
                  value={details.contact_phone}
                  onChange={e => setDetails(d => ({ ...d, contact_phone: e.target.value }))}
                />
              </div>
            </section>
          )}

          {formError && <div className="svy-alert svy-alert-error">{formError}</div>}

          <div className="svy-submit-row">
            <button type="submit" className="svy-submit" disabled={submitting}>
              {submitting ? t.submitting : t.submit}
            </button>
            <span className="svy-progress-text" style={{ margin: 0 }}>
              {t.progress(answeredCount, REQUIRED.length)}
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}
