const SAFER_BASE_URL = 'https://safer.fmcsa.dot.gov/saferapi/SaferRestServices';
const SAFER_API_KEY = process.env.SAFER_API_KEY; // Set this in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mc_number, usdot_number } = req.body;

  if (!mc_number && !usdot_number) {
    return res.status(400).json({ error: 'MC or USDOT number required' });
  }

  try {
    // Query SAFER API for carrier info
    const query = usdot_number || mc_number;
    const saferResponse = await fetch(
      `${SAFER_BASE_URL}/CarrierSnapshot?query=${query}&format=json`
    );

    if (!saferResponse.ok) {
      return res.status(404).json({
        error: 'Carrier not found',
        carrier_name: 'N/A',
        total_score: 0,
        grade: 'F',
        auto_reject: 'true',
        auto_reject_reasons: 'Carrier not found in SAFER database'
      });
    }

    const saferData = await saferResponse.json();
    
    console.log('SAFER Response:', JSON.stringify(saferData, null, 2));

    // Extract carrier info
    const carrier = saferData.carrier || {};
    const crashes = saferData.crashes || {};
    const inspections = saferData.inspections || {};

    // Extract FMCSA Authority & Age
    const usdotStatus = carrier.usdot_status || 'Unknown';
    const operatingAuthority = carrier.operating_authority || 'Unknown';
    const authorityAge = calculateAuthorityAge(carrier.date_of_authority);
    const mcsCurrent = carrier.mcs_150_form_date ? isCurrentMCS150(carrier.mcs_150_form_date) : false;

    // Extract Safety Compliance Metrics
    const safetyRating = carrier.safety_rating || 'Unknown';
    const drugAlcoholViolations = countDrugAlcoholViolations(saferData.violations);
    
    // CRITICAL FIX: Extract fatal crashes correctly from SAFER
    const fatalCrashes = crashes.fatal_count || crashes.fatalities || 0;
    const injuryCrashes = crashes.injury_count || crashes.injury_crashes || 0;

    // Extract Double Brokerage Risk
    const doubleBrokerageIndicator = carrier.double_brokerage_indicator || false;

    // Extract Inspections & OOS
    const vehicleInspections = inspections.vehicle_inspections || 0;
    const vehicleOOS = inspections.vehicle_oos || 0;
    const vehicleOOSRate = vehicleInspections > 0 ? (vehicleOOS / vehicleInspections) : 0;
    const vehicleOOSNationalAvg = 0.2226; // National average from FMCSA
    
    const driverInspections = inspections.driver_inspections || 0;
    const driverOOS = inspections.driver_oos || 0;
    const driverOOSRate = driverInspections > 0 ? (driverOOS / driverInspections) : 0;
    const driverOOSNationalAvg = 0.0667; // National average from FMCSA

    // Extract Insurance Verification
    const insuranceVerified = carrier.insurance_verified || false;
    const insuranceStatus = carrier.insurance_status || 'Unknown';

    // Extract Business Legitimacy (placeholder - adjust based on SAFER data)
    const businessLegitimacyScore = calculateBusinessLegitimacy(carrier);

    // Calculate weighted score (0-100)
    const scores = {
      fmcsa_authority: calculateFMCSAScore(usdotStatus, operatingAuthority, authorityAge, mcsCurrent),
      double_brokerage: doubleBrokerageIndicator ? 0 : 100,
      safety_compliance: calculateSafetyScore(safetyRating, drugAlcoholViolations, fatalCrashes, injuryCrashes),
      inspections_oos: calculateOOSScore(vehicleOOSRate, vehicleOOSNationalAvg, driverOOSRate, driverOOSNationalAvg, vehicleInspections),
      insurance_verification: insuranceVerified ? 100 : 50,
      business_legitimacy: businessLegitimacyScore
    };

    const weights = {
      fmcsa_authority: 0.20,
      double_brokerage: 0.25,
      safety_compliance: 0.20,
      inspections_oos: 0.15,
      insurance_verification: 0.15,
      business_legitimacy: 0.05
    };

    const totalScore = Math.round(
      (scores.fmcsa_authority * weights.fmcsa_authority +
       scores.double_brokerage * weights.double_brokerage +
       scores.safety_compliance * weights.safety_compliance +
       scores.inspections_oos * weights.inspections_oos +
       scores.insurance_verification * weights.insurance_verification +
       scores.business_legitimacy * weights.business_legitimacy) * 100
    ) / 100;

    // Determine grade
    const grade = getGrade(totalScore);

    // Check auto-reject triggers
    const autoRejectReasons = [];
    
    if (fatalCrashes > 0) autoRejectReasons.push('Fatal crash(es) on record');
    if (drugAlcoholViolations > 0) autoRejectReasons.push('Drug/alcohol violation(s)');
    if (doubleBrokerageIndicator) autoRejectReasons.push('Double brokerage risk detected');
    if (!insuranceVerified || insuranceStatus !== 'Active') autoRejectReasons.push('Insurance not verified or inactive');
    if (safetyRating === 'Unsatisfactory') autoRejectReasons.push('Unsatisfactory safety rating');
    if (totalScore < 60) autoRejectReasons.push(`Score too low: ${totalScore}`);

    const autoReject = autoRejectReasons.length > 0 ? 'true' : 'false';

    // Return comprehensive response
    return res.status(200).json({
      // Basic Info
      carrier_name: carrier.legal_name || 'Unknown',
      dba: carrier.dba_name || 'N/A',
      mc_number: mc_number,
      usdot_number: usdot_number || carrier.usdot_number,

      // FMCSA Authority & Age (20%)
      usdot_status: usdotStatus,
      operating_authority: operatingAuthority,
      authority_age_months: authorityAge,
      mcs_150_current: mcsCurrent,

      // Safety Compliance (20%)
      safety_rating: safetyRating,
      drug_alcohol_violations: drugAlcoholViolations,
      fatal_crashes: fatalCrashes,
      injury_crashes: injuryCrashes,

      // Double Brokerage (25%)
      double_brokerage_indicator: doubleBrokerageIndicator,

      // Inspections & OOS (15%)
      vehicle_inspections_count: vehicleInspections,
      vehicle_oos_count: vehicleOOS,
      vehicle_oos_rate: Math.round(vehicleOOSRate * 10000) / 10000,
      vehicle_oos_national_avg: vehicleOOSNationalAvg,
      driver_inspections_count: driverInspections,
      driver_oos_count: driverOOS,
      driver_oos_rate: Math.round(driverOOSRate * 10000) / 10000,
      driver_oos_national_avg: driverOOSNationalAvg,

      // Insurance (15%)
      insurance_verified: insuranceVerified,
      insurance_status: insuranceStatus,

      // Business Legitimacy (5%)
      business_legitimacy_score: businessLegitimacyScore,

      // Calculated Score
      total_score: totalScore,
      grade: grade,
      fmcsa_authority_score: scores.fmcsa_authority,
      double_brokerage_score: scores.double_brokerage,
      safety_compliance_score: scores.safety_compliance,
      inspections_oos_score: scores.inspections_oos,
      insurance_verification_score: scores.insurance_verification,
      business_legitimacy_score_calc: scores.business_legitimacy,

      // Auto-Reject
      auto_reject: autoReject,
      auto_reject_reasons: autoRejectReasons.length > 0 ? autoRejectReasons.join(' | ') : 'Carrier meets compliance requirements',
      checked_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Relay Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      error_message: error.message,
      carrier_name: 'N/A',
      total_score: 0,
      grade: 'F',
      auto_reject: 'true',
      auto_reject_reasons: `Server error: ${error.message}`
    });
  }
}

// Helper Functions
function calculateAuthorityAge(dateOfAuthority) {
  if (!dateOfAuthority) return 0;
  const date = new Date(dateOfAuthority);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  return Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30)); // months
}

function isCurrentMCS150(mcsFormDate) {
  if (!mcsFormDate) return false;
  const date = new Date(mcsFormDate);
  const now = new Date();
  const diffMonths = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  return diffMonths < 24; // Current if within 24 months
}

function countDrugAlcoholViolations(violations) {
  if (!violations || !Array.isArray(violations)) return 0;
  return violations.filter(v =>
    v.description &&
    (v.description.toLowerCase().includes('drug') || v.description.toLowerCase().includes('alcohol'))
  ).length;
}

function calculateFMCSAScore(status, authority, age, mcsCurrent) {
  let score = 0;
  if (status === 'Active') score += 25;
  if (authority === 'Active') score += 35;
  if (age >= 24) score += 25; // 2 years or more
  if (mcsCurrent) score += 15;
  return score;
}

function calculateSafetyScore(rating, drugAlcohol, fatal, injury) {
  let score = 0;
  if (rating === 'Satisfactory') score += 35;
  if (drugAlcohol === 0) score += 30;
  if (fatal === 0) score += 20;
  score += Math.max(0, 8 - (injury * 2)); // Reduce points per injury crash
  return Math.min(100, score);
}

function calculateOOSScore(vehicleRate, vehicleAvg, driverRate, driverAvg, inspections) {
  let score = 0;
  if (vehicleRate <= vehicleAvg * 0.8) score += 45;
  if (driverRate <= driverAvg * 1.0) score += 25;
  if (inspections >= 15) score += 20;
  return Math.min(100, score);
}

function calculateBusinessLegitimacy(carrier) {
  let score = 50;
  if (carrier.legal_name) score += 10;
  if (carrier.dba_name) score += 10;
  if (carrier.principal_address) score += 10;
  if (carrier.phone_number) score += 5;
  return Math.min(100, score);
}

function getGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
