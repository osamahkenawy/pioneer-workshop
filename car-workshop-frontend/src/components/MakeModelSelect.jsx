/**
 * Make and model pickers, shared by every vehicle form (the work order
 * wizard, Vehicles, Customers).
 *
 * The make is a list (lib/carCatalog.js); picking another make empties the
 * model, which is then a list of that make's models. A make or model the list
 * doesn't have is typed ("Other — type it"). A value already on the vehicle
 * always shows, listed or not, in any spelling: editing a JAC or a Hybrid
 * Camry used to show both boxes empty (client review, 2 Nov 2026).
 *
 * `onChange(value, picked)` on the make: `picked` is true when a list entry
 * (or "Other") was chosen — the caller then empties the model — and false
 * while a make is being typed.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAR_MAKES, catalogMake, modelsOf, catalogModel } from '../lib/carCatalog';

const OTHER = '__other__';

export function MakeSelect({ value, onChange, style, className, field, invalid, required, disabled }) {
  const { t } = useTranslation();
  const known = catalogMake(value);
  const [typing, setTyping] = useState(false);
  // A make on file that isn't listed is offered as itself.
  const own = !typing && !known ? String(value ?? '').trim() : '';
  return (
    <>
      <select style={style} className={className} data-field={typing ? undefined : field} aria-invalid={invalid || undefined}
        required={required} disabled={disabled} value={typing ? OTHER : (known || own)}
        onChange={e => {
          const v = e.target.value;
          setTyping(v === OTHER);
          onChange(v === OTHER ? '' : v, true);
        }}>
        <option value="">{t('vehicles.select_make', 'Select make…')}</option>
        {own && <option value={own}>{own}</option>}
        {CAR_MAKES.map(m => <option key={m} value={m}>{m}</option>)}
        <option value={OTHER}>{t('vehicles.other_make', 'Other — type the make')}</option>
      </select>
      {typing && (
        <input style={{ ...style, marginTop: 8 }} className={className} data-field={field} aria-invalid={invalid || undefined}
          aria-label={t('vehicles.make', 'Make')} maxLength={100} autoComplete="off" autoFocus required={required}
          placeholder={t('vehicles.type_make', 'Type the make')} value={value} onChange={e => onChange(e.target.value, false)} />
      )}
    </>
  );
}

export function ModelSelect({ make, value, onChange, style, className, field, invalid, required, disabled }) {
  const { t } = useTranslation();
  const models = modelsOf(make);
  const known = catalogModel(make, value);
  // "Other" is remembered per make, so picking another make starts from its list.
  const [typingFor, setTypingFor] = useState(null);
  const typing = typingFor !== null && typingFor === catalogMake(make);
  const noMake = !String(make ?? '').trim();
  if (!models.length) {
    // No make yet, or one the list doesn't have: the model is typed.
    return (
      <input style={style} className={className} data-field={field} aria-invalid={invalid || undefined}
        required={required} disabled={disabled || noMake} maxLength={100} autoComplete="off"
        placeholder={noMake ? t('vehicles.make_first', 'Select the make first') : t('vehicles.type_model', 'Type the model')}
        value={value} onChange={e => onChange(e.target.value)} />
    );
  }
  const own = !typing && !known ? String(value ?? '').trim() : '';
  return (
    <>
      <select style={style} className={className} data-field={typing ? undefined : field} aria-invalid={invalid || undefined}
        required={required} disabled={disabled} value={typing ? OTHER : (known || own)}
        onChange={e => {
          const v = e.target.value;
          setTypingFor(v === OTHER ? catalogMake(make) : null);
          onChange(v === OTHER ? '' : v);
        }}>
        <option value="">{t('vehicles.select_model', 'Select model…')}</option>
        {own && <option value={own}>{own}</option>}
        {models.map(m => <option key={m} value={m}>{m}</option>)}
        <option value={OTHER}>{t('vehicles.other_model', 'Other — type the model')}</option>
      </select>
      {typing && (
        <input style={{ ...style, marginTop: 8 }} className={className} data-field={field} aria-invalid={invalid || undefined}
          aria-label={t('vehicles.model', 'Model')} maxLength={100} autoComplete="off" autoFocus required={required}
          placeholder={t('vehicles.type_model', 'Type the model')} value={value} onChange={e => onChange(e.target.value)} />
      )}
    </>
  );
}
