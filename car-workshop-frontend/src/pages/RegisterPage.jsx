import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { StatsUpSquare, Rocket, Globe, Lock, Check } from 'iconoir-react';
import SEO from '../components/SEO';
import PhoneInput from '../components/PhoneInput';
import './RegisterPage.css';

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [formData, setFormData] = useState({
    company_name: '',
    full_name: '',
    email: '',
    phone: '',
    industry: '',
    message: ''
  });
  const [phoneCode, setPhoneCode] = useState('+971');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const industries = [
    'Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing',
    'Real Estate', 'Education', 'Hospitality', 'Consulting', 'Automotive',
    'Construction', 'Legal', 'Marketing', 'Insurance', 'Other'
  ];

  const translateIndustry = (industry) => {
    return t(`industries.${industry}`, { defaultValue: industry });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const inquiryData = {
        name: formData.full_name,
        email: formData.email,
        subject: `Free Trial Request - ${formData.company_name}`,
        message: `
Free Trial Inquiry

Company Name: ${formData.company_name}
Contact Name: ${formData.full_name}
Email: ${formData.email}
Phone: ${formData.phone ? phoneCode + formData.phone : 'Not provided'}
Industry: ${formData.industry || 'Not specified'}

Additional Message:
${formData.message || 'No additional message'}

---
This inquiry was submitted through the Free Trial registration form.
        `.trim()
      };

      const response = await fetch('https://pioneercarservice.com/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inquiryData)
      });

      const data = await response.json();

      if (response.ok) {
        setSuccess(true);
        setFormData({
          company_name: '',
          full_name: '',
          email: '',
          phone: '',
          industry: '',
          message: ''
        });
      } else {
        setError(data.error || t('auth.registrationFailed'));
      }
    } catch (err) {
      console.error('Inquiry submission error:', err);
      setError(t('auth.registrationFailedPleaseTryAgain'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="register-page">
        <SEO page="register" />
        <div className="register-container">
          {/* Left Side - Features */}
          <div className="register-features">
            <div className="brand-logo">
              <img src="/assets/images/logos/PIONEER._WHITE_LOGOsvg.svg" alt="Pioneer" />
            </div>

            <h2>{t('auth.transformYourBusiness')}</h2>
            <p className="tagline">
              {t('auth.joinThousands')}
            </p>

            <ul className="features-list">
              <li>
                <div className="feature-icon gradient-1"><StatsUpSquare width={24} height={24} /></div>
                <div className="feature-content">
                  <strong>{t('auth.completeCrmSolution')}</strong>
                  <p>{t('auth.manageLeadsDeals')}</p>
                </div>
              </li>
              <li>
                <div className="feature-icon gradient-2"><Rocket width={24} height={24} /></div>
                <div className="feature-content">
                  <strong>{t('auth.builtForGrowth')}</strong>
                  <p>{t('auth.scaleSeamlessly')}</p>
                </div>
              </li>
              <li>
                <div className="feature-icon gradient-3"><Globe width={24} height={24} /></div>
                <div className="feature-content">
                  <strong>{t('auth.multiLanguageCurrency')}</strong>
                  <p>{t('auth.supportForArabic')}</p>
                </div>
              </li>
              <li>
                <div className="feature-icon gradient-4"><Lock width={24} height={24} /></div>
                <div className="feature-content">
                  <strong>{t('auth.enterpriseSecurity')}</strong>
                  <p>{t('auth.roleBasedAccess')}</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Right Side - Success Message */}
          <div className="register-form-section">
            <div className="register-card success-card">
              <div className="success-icon"><Check width={32} height={32} /></div>
              <h1>{t('auth.thankYou', { defaultValue: 'Thank You!' })}</h1>
              <p className="success-message">
                {t('auth.freeTrialRequestReceived', { defaultValue: 'Your free trial request has been received. Our team will contact you shortly to set up your account.' })}
              </p>
              <div className="success-actions">
                <Link to="/" className="btn-primary">
                  {t('auth.backToHome')}
                </Link>
                <Link to="/login" className="btn-outline">
                  {t('auth.signIn')}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <SEO page="register" />
      <div className="register-container">
        {/* Left Side - Features */}
        <div className="register-features">
          <div className="brand-logo">
            <img src="/assets/images/logos/PIONEER._WHITE_LOGOsvg.svg" alt="Pioneer" />
          </div>

          <h2>{t('auth.transformYourBusiness')}</h2>
          <p className="tagline">
            {t('auth.joinThousands')}
          </p>

          <ul className="features-list">
            <li>
              <div className="feature-icon gradient-1"><StatsUpSquare width={24} height={24} /></div>
              <div className="feature-content">
                <strong>{t('auth.completeCrmSolution')}</strong>
                <p>{t('auth.manageLeadsDeals')}</p>
              </div>
            </li>
            <li>
              <div className="feature-icon gradient-2"><Rocket width={24} height={24} /></div>
              <div className="feature-content">
                <strong>{t('auth.builtForGrowth')}</strong>
                <p>{t('auth.scaleSeamlessly')}</p>
              </div>
            </li>
            <li>
              <div className="feature-icon gradient-3"><Globe width={24} height={24} /></div>
              <div className="feature-content">
                <strong>{t('auth.multiLanguageCurrency')}</strong>
                <p>{t('auth.supportForArabic')}</p>
              </div>
            </li>
            <li>
              <div className="feature-icon gradient-4"><Lock width={24} height={24} /></div>
              <div className="feature-content">
                <strong>{t('auth.enterpriseSecurity')}</strong>
                <p>{t('auth.roleBasedAccess')}</p>
              </div>
            </li>
          </ul>

          <div className="stats-bar">
            <div className="stat-item">
              <span className="stat-number">10K+</span>
              <span className="stat-label">{t('auth.users')}</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">50+</span>
              <span className="stat-label">{t('auth.countries')}</span>
            </div>
            <div className="stat-item">
              <span className="stat-number">99.9%</span>
              <span className="stat-label">{t('auth.uptime')}</span>
            </div>
          </div>
        </div>

        {/* Right Side - Registration Form */}
        <div className="register-form-section">
          <div className="register-card">
            <div className="register-header">
              <h1>{t('auth.requestFreeTrial', { defaultValue: 'Request Free Trial' })}</h1>
              <p>{t('auth.fillFormToGetStarted', { defaultValue: 'Fill the form below and our team will contact you' })}</p>
            </div>

            <form onSubmit={handleSubmit} className="register-form">
              {error && <div className="register-error">{error}</div>}

              <div className="form-group">
                <label htmlFor="company_name">
                  {t('auth.companyName')} <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="company_name"
                  name="company_name"
                  value={formData.company_name}
                  onChange={handleChange}
                  placeholder={t('auth.enterCompanyName')}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="full_name">
                  {t('auth.yourName')} <span className="required">*</span>
                </label>
                <input
                  type="text"
                  id="full_name"
                  name="full_name"
                  value={formData.full_name}
                  onChange={handleChange}
                  placeholder={t('auth.enterFullName')}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="email">
                    {t('auth.workEmail')} <span className="required">*</span>
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder={t('auth.youAtCompany')}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">
                    {t('auth.phoneNumber', { defaultValue: 'Phone Number' })}
                  </label>
                  <PhoneInput
                    id="phone"
                    value={formData.phone}
                    onChange={v => setFormData(prev => ({ ...prev, phone: v }))}
                    phoneCode={phoneCode}
                    onPhoneCodeChange={setPhoneCode}
                    placeholder={t('auth.enterPhoneNumber', { defaultValue: 'Enter phone number' })}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="industry">{t('auth.industry')}</label>
                <select
                  id="industry"
                  name="industry"
                  value={formData.industry}
                  onChange={handleChange}
                >
                  <option value="">{t('auth.selectIndustry')}</option>
                  {industries.map(ind => (
                    <option key={ind} value={ind}>{translateIndustry(ind)}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="message">
                  {t('auth.additionalMessage', { defaultValue: 'Additional Message' })}
                </label>
                <textarea
                  id="message"
                  name="message"
                  value={formData.message}
                  onChange={handleChange}
                  placeholder={t('auth.tellUsAboutYourNeeds', { defaultValue: 'Tell us about your needs...' })}
                  rows={3}
                />
              </div>

              <button type="submit" className="register-btn" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner"></span>
                    {t('auth.submitting', { defaultValue: 'Submitting...' })}
                  </>
                ) : (
                  <>
                    {t('auth.startFreeTrial')}
                    <span style={{ [isRTL?'marginRight':'marginLeft']: '8px' }}>→</span>
                  </>
                )}
              </button>

              <div className="trial-benefits">
                <span><span className="check-icon"><Check width={14} height={14} /></span> {t('auth.dayFreeTrial')}</span>
                <span><span className="check-icon"><Check width={14} height={14} /></span> {t('auth.noCreditCard')}</span>
                <span><span className="check-icon"><Check width={14} height={14} /></span> {t('auth.cancelAnytime')}</span>
              </div>
            </form>

            <div className="register-footer">
              <p>
                {t('auth.alreadyHaveAccount')}{' '}
                <Link to="/login">{t('auth.signIn')}</Link>
              </p>
              <Link to="/" className="back-home">← {t('auth.backToHome')}</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
