/**
 * actions.js — what a person can do from the Vehicle Status Board. The board
 * itself changes nothing: every action opens the job card or sends the
 * customer their status link.
 *
 *   open      the job card (/work-orders/:id)
 *   copyLink  the customer's status link (customerStatusUrl)
 *   sms       the link by SMS (POST /service-status/:token/send-sms)
 *   whatsapp  a status message to the customer's phone (buildStatusMessage)
 *   print     the job sheet PDF (GET /work-orders/:id/label)
 *
 * The token actions need the job's service_status_token: hide them without it.
 */
import { useCallback, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { AuthContext } from '../../context/AuthContext';
import { customerStatusUrl } from '../../lib/customerLink';
import { buildStatusMessage, shareViaWhatsApp } from '../../lib/whatsapp';
import { amountDue, copyText } from './board';

/**
 * @param {(message: string, type?: string) => void} showToast
 * @returns {{ open, copyLink, sms, whatsapp, print, canLink, canWhatsApp }}
 */
export function useBoardActions(showToast) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { workshop } = useContext(AuthContext) || {};
  const currency = workshop?.currency || 'AED';

  const open = useCallback(item => navigate(`/work-orders/${item.id}`), [navigate]);

  const copyLink = useCallback(async item => {
    const url = customerStatusUrl(item.service_status_token);
    if (!url) return;
    const ok = await copyText(url);
    showToast(ok ? t('vehicleBoard.act.link_copied', 'Customer link copied') : t('vehicleBoard.act.copy_failed', "Couldn't copy the link"), ok ? 'success' : 'error');
  }, [showToast, t]);

  const sms = useCallback(async item => {
    if (!item.service_status_token) return;
    const phone = item.customer_phone || '';
    if (!window.confirm(t('vehicleBoard.act.sms_confirm', 'Send the status link to {{phone}} by SMS?', { phone }))) return;
    try {
      const res = await api.post(`/service-status/${encodeURIComponent(item.service_status_token)}/send-sms`);
      if (res?.success) showToast(t('vehicleBoard.act.sms_sent', 'Status link sent by SMS'), 'success');
      else showToast(res?.message || t('vehicleBoard.act.sms_failed', "Couldn't send the SMS"), 'error');
    } catch {
      showToast(t('vehicleBoard.act.sms_failed', "Couldn't send the SMS"), 'error');
    }
  }, [showToast, t]);

  const whatsapp = useCallback(item => {
    const wo = {
      ...item,
      plate_number: item.plate,
      // A pending job the customer approved reads "Work approved", as everywhere else.
      customer_approved_at: item.customer_approved ? 'approved' : null,
    };
    const message = buildStatusMessage({
      t, wo, amountDue: amountDue(item), currency, workshopName: workshop?.name,
      link: customerStatusUrl(item.service_status_token),
    });
    shareViaWhatsApp(item.customer_phone, message);
  }, [currency, t, workshop?.name]);

  const print = useCallback(async item => {
    // Open the tab now: a window opened after the download would be blocked.
    const win = window.open('', '_blank');
    try {
      const res = await api.raw(`/work-orders/${item.id}/label`);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (win) win.close();
      showToast(t('vehicleBoard.act.print_failed', "Couldn't open the job sheet"), 'error');
    }
  }, [showToast, t]);

  const canLink = item => !!item?.service_status_token;
  const canWhatsApp = item => !!String(item?.customer_phone || '').replace(/\D/g, '');

  return { open, copyLink, sms, whatsapp, print, canLink, canWhatsApp };
}

export default useBoardActions;
