export default async function handler(req, res) {
  const { method } = req;
  if (method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mc_number, usdot_number } = req.body;
  if (!mc_number && !usdot_number) {
    return res.status(400).json({ error: 'MC or USDOT number required' });
  }

  const SAFERWEB_API_KEY = 'f954a18ce8b648c2be8925bcc94e7e28'; // Use secure .env later
  const carrier_id = usdot_number || mc_number;

  try {
    const fetchWithApiKey = (url) =>
      fetch(url, {
        headers: { 'x-api-key': SAFERWEB_API_KEY },
      }).then(r => r.json());

    // Snapshot: MC or USDOT
    const snapshotUrl = mc_number
      ? `https://saferwebapi.com/v2/mcmx/snapshot/${mc_number}`
      : `https://saferwebapi.com/v2/usdot/snapshot/${usdot_number}`;

    // Historical records
    const inspectionUrl = `https://saferwebapi.com/v3/history/inspection/${carrier_id}`;
    const violationUrl  = `https://saferwebapi.com/v3/history/violation/${carrier_id}`;
    const crashUrl      = `https://saferwebapi.com/v3/history/crash/${carrier_id}`;

    const [snapshot, inspections, violations, crashes] = await Promise.all([
      fetchWithApiKey(snapshotUrl),
      fetchWithApiKey(inspectionUrl),
      fetchWithApiKey(violationUrl),
      fetchWithApiKey(crashUrl)
    ]);

    const crashRecords   = crashes.crash_records || [];
    // Deduplicate crash events by report number (each crash may include multiple vehicle records)
    const crashEventsMap = {};
    crashRecords.forEach((rec) => {
      const key = rec.report_number || rec.report_no || rec.reportNumber || rec.report || rec.reportNum;
      if (!crashEventsMap[key]) {
        crashEventsMap[key] = { fatal: false };
      }
      if ((rec.total_fatalities || rec.fatalities || 0) > 0) {
        crashEventsMap[key].fatal = true;
      }
    });
    const crash_count   = Object.keys(crashEventsMap).length;
    const fatal_crashes = Object.values(crashEventsMap).filter((e) => e.fatal).length;

    // Violations count is based on number of violation records
    const violationRecords = violations.violation_records || [];
    const violations_count = violationRecords.length;

    // Deduplicate inspection events by report number for inspection count
    const inspectionRecords = inspections.inspection_records || [];
    const inspection_count = new Set(
      inspectionRecords.map((r) =>
        r.report_number || r.report_no || r.reportNumber || r.report || r.reportNum
      )
    ).size;

    // Weighted scoring
    const maxViolations  = 200;
    const maxInspections = 300;
    const maxCrashes     = 100;
    let score = 100;
    score -= (violations_count / maxViolations) * 40;
    score -= (inspection_count / maxInspections) * 30;
    score -= (crash_count / maxCrashes) * 20;
    score -= fatal_crashes * 10;
    const total_score = Math.max(0, Math.min(100, score));

    // Grades
    let grade = 'F';
    if (total_score >= 90)      grade = 'A';
    else if (total_score >= 80) grade = 'B';
    else if (total_score >= 70) grade = 'C';
    else if (total_score >= 50) grade = 'D';

    // Status and auto-reject
    let auto_reject = 'false';
    let reasons = [];
    const status = snapshot.operating_status || snapshot.carrier_status || 'Unknown';
    const normalizedStatus = typeof status === 'string' ? status.toUpperCase() : status;

    if (normalizedStatus !== 'ACTIVE') {
      auto_reject = 'true';
      reasons.push(`Carrier status: ${status}`);
    }
    if (fatal_crashes > 0) {
      auto_reject = 'true';
      reasons.push(`Fatal crashes: ${fatal_crashes}`);
    }
    if (total_score < 50) {
      auto_reject = 'true';
      reasons.push(`Score too low: ${total_score}`);
    }

    return res.status(200).json({
      carrier_name: snapshot.legal_name || 'N/A',
      dba:          snapshot.dba_name   || 'N/A',
      mc_number,
      usdot_number: carrier_id,
      carrier_status: status,
      total_score,
      grade,
      inspections_count: inspection_count,
      violations_count:  violations_count,
      crash_count,
      fatal_crashes,
      auto_reject,
      auto_reject_reasons: reasons.join(' | ') || 'None',
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: true,
      error_message: error.message,
      mc_number,
      usdot_number: carrier_id,
      total_score: 0,
      grade: 'F',
      auto_reject: 'true',
      auto_reject_reasons: `API Error: ${error.message}`,
      checked_at: new Date().toISOString()
    });
  }
}
