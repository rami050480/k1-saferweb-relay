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
      }).then(res => res.json());

    const snapshotUrl = mc_number
      ? `https://saferwebapi.com/v2/mcmx/snapshot/${mc_number}`
      : `https://saferwebapi.com/v2/usdot/snapshot/${usdot_number}`;

    const inspectionUrl = `https://saferwebapi.com/v3/history/inspection/${carrier_id}`;
    const violationUrl = `https://saferwebapi.com/v3/history/violation/${carrier_id}`;
    const crashUrl = `https://saferwebapi.com/v3/history/crash/${carrier_id}`;

    const [snapshot, inspections, violations, crashes] = await Promise.all([
      fetchWithApiKey(snapshotUrl),
      fetchWithApiKey(inspectionUrl),
      fetchWithApiKey(violationUrl),
      fetchWithApiKey(crashUrl)
    ]);

    const crashRecords = crashes.crash_records || [];
    const crash_count = crashRecords.length;
    const fatal_crashes = crashRecords.filter(c => (c.total_fatalities || c.fatalities || 0) > 0).length;
    const violations_count = (violations.violation_records || []).length;
    const inspection_count = (inspections.inspection_records || []).length;

    let score = 100;
    score -= violations_count * 2;
    score -= inspection_count;
    score -= crash_count * 5;
    score -= fatal_crashes * 15;
    const total_score = Math.max(0, Math.min(100, score));

    let grade = 'F';
    if (total_score >= 95) grade = 'A+';
    else if (total_score >= 90) grade = 'A';
    else if (total_score >= 85) grade = 'B+';
    else if (total_score >= 80) grade = 'B';
    else if (total_score >= 75) grade = 'C+';
    else if (total_score >= 70) grade = 'C';
    else if (total_score >= 65) grade = 'D';

    let auto_reject = 'false';
    let reasons = [];
    const status = snapshot.carrier_status || 'Unknown';

    if (status !== 'Active') {
      auto_reject = 'true';
      reasons.push(`Carrier status: ${status}`);
    }
    if (fatal_crashes > 0) {
      auto_reject = 'true';
      reasons.push(`Fatal crashes: ${fatal_crashes}`);
    }
    if (total_score < 60) {
      auto_reject = 'true';
      reasons.push(`Score too low: ${total_score}`);
    }

    return res.status(200).json({
      carrier_name: snapshot.legal_name || 'N/A',
      dba: snapshot.dba_name || 'N/A',
      mc_number,
      usdot_number: carrier_id,
      carrier_status: status,
      total_score,
      grade,
      inspections_count: inspection_count,
      violations_count: violations_count,
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
