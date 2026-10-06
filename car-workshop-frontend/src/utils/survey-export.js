/**
 * survey-export.js — the response-level survey sheet, built once.
 *
 * Both the Customer Experience pack and the Customer Feedback export need the
 * same thing: one row per respondent with every answer they gave. Two copies
 * of a 25-column sheet definition would drift the first time a question is
 * added, and the two exports would then disagree about the same data — so
 * they share this.
 */
import { th, num, dt } from './xlsx';

/**
 * The eight 1-5 scaled answers, in the order the survey asks them: both CES
 * items, then the six CSAT items.
 *
 * resolution, nps_score and nps_reason are the other three questions but are
 * not on this list, because they are not 1-5 scales — an enum, a 0-10 score
 * and free text — and each needs its own column treatment.
 */
export const RESPONSE_ANSWER_COLS = [
  'ces_find_channel',
  'ces_easy_handle',
  'csat_overall',
  'csat_as_advertised',
  'csat_expectations',
  'csat_rep_knowledge',
  'csat_communication',
  'csat_response_time',
];

const nn = v => (v === null || v === undefined || v === '' ? null : Number(v));

/**
 * One sheet: a header row of question wording, then a row per response.
 *
 * `labels` is the question map the export endpoint returns alongside the rows.
 * Headed by the wording rather than the column name because
 * "csat_as_advertised" means nothing to anyone reading the pack; the column
 * name is the fallback only if the endpoint sent no labels.
 */
export function responsesSheet(rows, labels = {}, name = 'Responses') {
  return {
    name,
    stickyRows: 1,
    columns: [
      { width: 17 }, { width: 22 }, { width: 18 }, { width: 26 },
      { width: 14 }, { width: 20 }, { width: 9 }, { width: 9 },
      ...RESPONSE_ANSWER_COLS.map(() => ({ width: 13 })),
      { width: 11 }, { width: 9 }, { width: 9 }, { width: 9 },
      { width: 62 }, { width: 11 }, { width: 17 }, { width: 46 },
    ],
    rows: [
      [
        th('Submitted'), th('Name'), th('Phone'), th('Email'),
        th('Branch'), th('Service'), th('Language'), th('Source'),
        ...RESPONSE_ANSWER_COLS.map(c => th(labels[c] || c)),
        th(labels.resolution || 'Resolved?'),
        th('NPS (of 10)'), th('CES avg'), th('CSAT avg'),
        th(labels.nps_reason || 'Reason for the score'),
        th('Needs follow-up'), th('Followed up'), th('Follow-up outcome'),
      ],
      ...(rows || []).map(r => [
        dt(r.submitted_at),
        r.contact_name || '',
        r.contact_phone || '',
        r.contact_email || '',
        r.branch || 'Unspecified',
        r.service_requested || '',
        r.language || '',
        r.source || '',
        ...RESPONSE_ANSWER_COLS.map(c => num(r[c])),
        r.resolution || '',
        num(nn(r.nps_score)),
        num(nn(r.ces_avg), 2),
        num(nn(r.csat_avg), 2),
        r.nps_reason || '',
        r.is_flagged ? 'Yes' : 'No',
        dt(r.followed_up_at),
        r.follow_up_notes || '',
      ]),
    ],
  };
}

export default responsesSheet;
