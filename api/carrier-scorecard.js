/**
 * Carrier Scorecard API Endpoint
 * 
 * HTTP Handler for Vercel serverless function
 * Fetches carrier data and runs auto-scoring model
 */

export default async function handler(req, res) {
  const { method } = req;
  
  // Only allow GET requests
  if (method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mc_number } = req.query;
  
  if (!mc_number) {
    return res.status(400).json({ error: 'MC number required' });
  }

  try {
        // Fetch carrier data directly from SAFERWeb API
    const apiKey = process.env.SAFERWEB_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const response = await fetch(`https://saferwebapi.com/v2/mcmx/snapshot/${mc_number}`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey }
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Failed to fetch carrier data from SAFERWeb',
        status: response.status
      });
    }

    const carrierData = await response.json();
    // Transform and score the data
    const scorecard = calculateScorecard({
      carrier: carrierData,
      // Map the SAFER data to scorecard format
      usdot_status: carrierData.dotNumber ? 'Active' : 'Inactive',
      operating_authority_status: carrierData.mcNumber ? 'Active' : 'Inactive',
      authority_age_months: calculateAuthorityAge(carrierData.allowedToOperate),
      mcs150_biennial_update: carrierData.bipdInsuranceOnFile ? 'Current' : 'Outdated',
      safety_rating: carrierData.safetyRating || 'None',
      drug_alcohol_violations: 0, // Would need additional data
      fatal_crashes: carrierData.totalFatalCrashes || 0,
      injury_crashes: carrierData.totalInjuryCrashes || 0,
      vehicle_oos_rate_pct: carrierData.vehicleOOSPct || 0,
      driver_oos_rate_pct: carrierData.driverOOSPct || 0,
      total_inspections_24mo: carrierData.totalInspections || 0,
      national_avg_vehicle: 20, // Default values - should be from stats
      national_avg_driver: 5,
      bipd_filing_active: carrierData.bipdInsuranceOnFile || false,
      bipd_limit_usd: 750000, // Would need to parse from insurance data
      cargo_insurance_verified: carrierData.cargoInsuranceOnFile || false,
      insurer_callback_status: 'NotDone',
      authority_scope_mismatch: false,
      contact_mismatch: false,
      email_type: 'Unknown',
      insurance_holder_is_third_party: false,
      load_reposting_observed: false,
      reposting_disclosed: false,
      website_active_12mo: false,
      facebook_active_12mo: false,
      address_consistent_with_fmcsa: true,
      growth_trend_pct: 0,
      fatal_crash_at_fault: false
    });

    return res.status(200).json({
      ...scorecard,
      carrier: {
        legalName: carrierData.legalName,
        dbaName: carrierData.dbaName,
        mcNumber: carrierData.mcNumber,
        dotNumber: carrierData.dotNumber
      }
    });

  } catch (error) {
    console.error('Error processing scorecard:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

// Helper function to calculate authority age in months
function calculateAuthorityAge(allowedToOperate) {
  if (!allowedToOperate) return 0;
  const operateDate = new Date(allowedToOperate);
  const now = new Date();
  const months = (now.getFullYear() - operateDate.getFullYear()) * 12 + 
                 (now.getMonth() - operateDate.getMonth());
  return Math.max(0, months);
}

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
function calculateScorecard(data) {
  const scores = {
    fmcsaAuthorityAge: scoreFMCSAAuthorityAge(data),
    doubleBrokerageRisk: scoreDoubleBrokerageRisk(data),
    safetyCompliance: scoreSafetyCompliance(data),
    inspectionsOOS: scoreInspectionsOOS(data),
    insuranceVerification: scoreInsuranceVerification(data),
    businessLegitimacy: scoreBusinessLegitimacy(data)
  };

  // Calculate weighted total (out of 100)
  const totalScore = 
    scores.fmcsaAuthorityAge * 0.20 +
    scores.doubleBrokerageRisk * 0.25 +
    scores.safetyCompliance * 0.20 +
    scores.inspectionsOOS * 0.15 +
    scores.insuranceVerification * 0.15 +
    scores.businessLegitimacy * 0.05;

  return {
    totalScore: Math.round(totalScore),
    categoryScores: scores,
    timestamp: new Date().toISOString()
  };
}

// 1. FMCSA Authority Age (20%)
function scoreFMCSAAuthorityAge(data) {
  const age = data.authority_age_months || 0;
  if (age >= 36) return 100;
  if (age >= 24) return 80;
  if (age >= 12) return 60;
  if (age >= 6) return 40;
  return 20;
}

// 2. Double-Brokerage Risk (25%)
function scoreDoubleBrokerageRisk(data) {
  let score = 100;
  if (data.authority_scope_mismatch) score -= 30;
  if (data.load_reposting_observed && !data.reposting_disclosed) score -= 40;
  if (data.contact_mismatch) score -= 20;
  if (data.insurance_holder_is_third_party) score -= 10;
  return Math.max(0, score);
}

// 3. Safety Compliance (20%)
function scoreSafetyCompliance(data) {
  let score = 100;
  
  if (data.safety_rating === 'Unsatisfactory') score = 0;
  else if (data.safety_rating === 'Conditional') score = 50;
  else if (data.safety_rating === 'Satisfactory') score = 100;
  else if (data.safety_rating === 'None') score = 70;
  
  if (data.drug_alcohol_violations > 0) score -= 20;
  if (data.fatal_crash_at_fault) score -= 30;
  
  return Math.max(0, score);
}

// 4. Inspections/OOS (15%)
function scoreInspectionsOOS(data) {
  let score = 100;
  const vehicleOOS = data.vehicle_oos_rate_pct || 0;
  const driverOOS = data.driver_oos_rate_pct || 0;
  const nationalVehicle = data.national_avg_vehicle || 20;
  const nationalDriver = data.national_avg_driver || 5;
  
  if (vehicleOOS > nationalVehicle * 2) score -= 40;
  else if (vehicleOOS > nationalVehicle) score -= 20;
  
  if (driverOOS > nationalDriver * 2) score -= 40;
  else if (driverOOS > nationalDriver) score -= 20;
  
  return Math.max(0, score);
}

// 5. Insurance Verification (15%)
function scoreInsuranceVerification(data) {
  let score = 0;
  
  if (data.bipd_filing_active) score += 40;
  if (data.bipd_limit_usd >= 1000000) score += 30;
  if (data.cargo_insurance_verified) score += 20;
  if (data.insurer_callback_status === 'Confirmed') score += 10;
  
  return score;
}

// 6. Business Legitimacy (5%)
function scoreBusinessLegitimacy(data) {
  let score = 0;
  
  if (data.website_active_12mo) score += 20;
  if (data.facebook_active_12mo) score += 20;
  if (data.address_consistent_with_fmcsa) score += 30;
  if (data.growth_trend_pct > 0) score += 30;
  
  return Math.min(100, score);
}
