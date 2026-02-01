/**
 * Carrier Scorecard Auto-Scoring Model v1.0.0
 * 
 * Implements weighted scoring based on FMCSA authoritative sources.
 * Categories:
 * 1. FMCSA Authority Age (20%)
 * 2. Double-Brokerage Risk (25%)
 * 3. Safety Compliance (20%)
 * 4. Inspections/OOS (15%)
 * 5. Insurance Verification (15%)
 * 6. Business Legitimacy (5%)
 */

export function calculateScorecard(data) {
  const categories = {
    fmcsaAuthorityAge: calculateAuthorityAge(data),
    doubleBrokerageRisk: calculateDoubleBrokerageRisk(data),
    safetyCompliance: calculateSafetyCompliance(data),
    inspectionsOOS: calculateInspectionsOOS(data),
    insuranceVerification: calculateInsuranceVerification(data),
    businessLegitimacy: calculateBusinessLegitimacy(data)
  };

  const weights = {
    fmcsaAuthorityAge: 0.20,
    doubleBrokerageRisk: 0.25,
    safetyCompliance: 0.20,
    inspectionsOOS: 0.15,
    insuranceVerification: 0.15,
    businessLegitimacy: 0.05
  };

  let totalScore = 0;
  for (const cat in categories) {
    totalScore += categories[cat].score * weights[cat];
  }

  totalScore = Math.round(totalScore);

  // Automatic Reject Triggers
  const rejectTriggers = checkRejectTriggers(data, categories);
  
  const recommendation = getRecommendation(totalScore, rejectTriggers);

  return {
    version: "1.0.0",
    name: "Standard Carrier Scorecard Auto-Scoring Model",
    score: totalScore,
    recommendation: recommendation.text,
    riskLevel: recommendation.riskLevel,
    categories,
    rejectTriggers,
    checkedAt: new Date().toISOString()
  };
}

function calculateAuthorityAge(data) {
  let score = 0;
  const { usdot_status, operating_authority_status, authority_age_months, mcs150_biennial_update } = data;

  if (usdot_status === 'Active') score += 25;
  if (operating_authority_status === 'Active') score += 35;

  if (authority_age_months >= 36) score += 25;
  else if (authority_age_months >= 24) score += 18;
  else if (authority_age_months >= 12) score += 10;

  if (mcs150_biennial_update === 'Current') score += 15;

  return { score, maxScore: 100 };
}

function calculateDoubleBrokerageRisk(data) {
  let score = 0;
  const { 
    authority_scope_mismatch, 
    contact_mismatch, 
    email_type, 
    insurance_holder_is_third_party,
    insurer_callback_status,
    load_reposting_observed
  } = data;

  if (!authority_scope_mismatch) score += 18;
  if (!contact_mismatch) score += 10;
  
  if (email_type === 'DomainMatch') score += 12;
  else if (email_type === 'FreeEmail') score += 4;

  if (!insurance_holder_is_third_party) score += 18;

  if (insurer_callback_status === 'Verified') score += 22;
  else if (insurer_callback_status === 'NotDone') score += 8;

  if (!load_reposting_observed) score += 20;

  return { score, maxScore: 100 };
}

function calculateSafetyCompliance(data) {
  let score = 0;
  const { safety_rating, drug_alcohol_violations, fatal_crashes, injury_crashes } = data;

  if (safety_rating === 'Satisfactory') score += 35;
  else if (safety_rating === 'None') score += 22;
  else if (safety_rating === 'Conditional') score += 8;

  if (drug_alcohol_violations === 0) score += 30;
  if (fatal_crashes === 0) score += 20;

  if (injury_crashes === 0) score += 15;
  else if (injury_crashes <= 2) score += 8;

  return { score, maxScore: 100 };
}

function calculateInspectionsOOS(data) {
  let score = 0;
  const { vehicle_oos_rate_pct, driver_oos_rate_pct, total_inspections_24mo, national_avg_vehicle, national_avg_driver } = data;

  // Vehicle OOS vs National Avg
  if (vehicle_oos_rate_pct <= national_avg_vehicle * 0.8) score += 45;
  else if (vehicle_oos_rate_pct <= national_avg_vehicle) score += 35;
  else if (vehicle_oos_rate_pct <= national_avg_vehicle * 1.2) score += 20;

  // Driver OOS vs National Avg
  if (driver_oos_rate_pct <= national_avg_driver * 0.8) score += 35;
  else if (driver_oos_rate_pct <= national_avg_driver) score += 25;
  else if (driver_oos_rate_pct <= national_avg_driver * 1.2) score += 10;

  if (total_inspections_24mo >= 15) score += 20;
  else if (total_inspections_24mo >= 5) score += 10;
  else score += 5;

  return { score, maxScore: 100 };
}

function calculateInsuranceVerification(data) {
  let score = 0;
  const { bipd_filing_active, bipd_limit_usd, cargo_insurance_verified, insurer_callback_status } = data;

  if (bipd_filing_active) score += 40;
  
  if (bipd_limit_usd >= 1000000) score += 25;
  else if (bipd_limit_usd >= 750000) score += 15;
  else score += 5;

  if (cargo_insurance_verified) score += 15;
  else score += 5;

  if (insurer_callback_status === 'Verified') score += 20;
  else if (insurer_callback_status === 'NotDone') score += 5;

  return { score, maxScore: 100 };
}

function calculateBusinessLegitimacy(data) {
  let score = 0;
  const { website_active_12mo, facebook_active_12mo, address_consistent_with_fmcsa, growth_trend_pct } = data;

  if (website_active_12mo) score += 35;
  else score += 10;

  if (facebook_active_12mo) score += 20;
  else score += 10;

  if (address_consistent_with_fmcsa) score += 25;

  if (growth_trend_pct >= 30) score += 20;
  else if (growth_trend_pct >= 11) score += 18;
  else if (growth_trend_pct >= 2) score += 10;
  else if (growth_trend_pct >= 1) score += 5;

  return { score, maxScore: 100 };
}

function checkRejectTriggers(data, categories) {
  const triggers = [];
  
  if (data.fatal_crashes > 0 && data.fatal_crash_at_fault) {
    triggers.push({ id: 'SAFETY_FATAL_CRASH', reason: 'Fatal crash with carrier fault' });
  }
  
  if (data.drug_alcohol_violations > 0) {
    triggers.push({ id: 'SAFETY_DRUG_ALCOHOL', reason: 'Drug/Alcohol violation present' });
  }

  if (data.safety_rating === 'Unsatisfactory') {
    triggers.push({ id: 'SAFETY_RATING_UNSAT', reason: 'FMCSA safety rating Unsatisfactory' });
  }

  if (data.insurer_callback_status === 'Refused') {
    triggers.push({ id: 'DB_REFUSED_INSURER_CALLBACK', reason: 'Refused insurer callback' });
  }

  if (data.authority_scope_mismatch) {
    triggers.push({ id: 'DB_OUTSIDE_AUTHORITY_SCOPE', reason: 'Operating outside authority scope' });
  }

  if (data.insurance_holder_is_third_party) {
    triggers.push({ id: 'DB_THIRD_PARTY_INS_HOLDER', reason: 'Third party listed as insurance holder' });
  }

  if (data.load_reposting_observed && !data.reposting_disclosed) {
    triggers.push({ id: 'DB_REPOSTING_NO_DISCLOSURE', reason: 'Load reposting without disclosure' });
  }

  return triggers;
}

function getRecommendation(score, triggers) {
  if (triggers.length > 0) {
    return { text: "Reject / Do Not Use", riskLevel: "High Risk (Auto-Reject)" };
  }
  
  if (score >= 86) return { text: "Approved Low Risk", riskLevel: "Low Risk" };
  if (score >= 75) return { text: "Conditional Verification Required", riskLevel: "Moderate Risk" };
  return { text: "Reject / Do Not Use", riskLevel: "High Risk" };
}
