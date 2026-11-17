import { db } from './client.js';
import { logger } from '../utils/logger.js';
import { uraService } from '../services/uraService.js';
import { ltaService } from '../services/ltaService.js';

export async function seed(): Promise<void> {
  logger.info('Seeding database...');

  try {
    // Check if ERP data already exists and has meaningful data
    const erpCount = await db.query('SELECT COUNT(*) FROM erp_gantries WHERE is_active = true');
    const hasMeaningfulERP = parseInt(erpCount.rows[0].count) > 0;

    // Always seed ERP from JSON if files exist (authoritative source)
    const fs = await import('fs');
    const path = await import('path');
    const fileURLToPath = (await import('url')).fileURLToPath;
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.join(__dirname, '../..');
    const jsonPath = path.join(projectRoot, 'erp_gantry_rates_2026-09-07.json');
    const hasJSONFiles = fs.existsSync(jsonPath);

    if (hasJSONFiles) {
      logger.info('Authoritative ERP JSON found, seeding ERP gantries...');
      await seedSampleERP();
    } else if (!hasMeaningfulERP) {
      logger.info('No ERP data and no JSON files, skipping ERP...');
    } else {
      logger.info('ERP data already seeded, skipping ERP...');
    }

    // Check if carpark data already exists
    const carparkCount = await db.query('SELECT COUNT(*) FROM carparks');
    const hasMeaningfulCarparks = parseInt(carparkCount.rows[0].count) > 0;

    if (!hasMeaningfulCarparks) {
      // Seed from external APIs if credentials available
      const hasURACreds = process.env.URA_ACCESS_KEY && process.env.URA_TOKEN;
      const hasLTACreds = process.env.LTA_API_KEY;

      if (hasURACreds) {
        logger.info('Syncing URA carpark data...');
        await uraService.syncToDatabase();
      } else {
        logger.warn('URA credentials not set, skipping carpark sync');
        await seedSampleCarparks();
      }

      if (hasLTACreds) {
        logger.info('Syncing LTA live data (traffic, carparks)...');
        await ltaService.syncToDatabase();
      }
    } else {
      logger.info('Carpark data already seeded, skipping carparks...');
    }

    logger.info('Database seeding completed');
  } catch (error) {
    logger.error({ error }, 'Seeding failed');
    throw error;
  }
}

async function seedSampleCarparks(): Promise<void> {
  logger.info('Inserting sample carparks...');

  // Sample rate schedule
  const rateScheduleResult = await db.query(
    `INSERT INTO rate_schedules (name, rate_json, effective_from)
     VALUES ('standard_hdb', $1, CURRENT_DATE)
     RETURNING id`,
    [JSON.stringify({
      base_rate: { weekday: 0.60, saturday: 0.60, sunday: 0.30 },
      per_half_hour: { weekday: 0.30, saturday: 0.30, sunday: 0.30 },
      max_daily: { weekday: 5.00, saturday: 5.00, sunday: 3.00 },
      night_parking: { start: '22:00', end: '07:00', rate: 2.00 },
      grace_period_minutes: 10,
    })]
  );
  const rateScheduleId = rateScheduleResult.rows[0].id;

  // Sample carparks around Singapore
  const sampleCarparks = [
    {
      code: 'HDB001',
      name: 'Tampines Central Carpark',
      provider: 'HDB',
      address: 'Blk 501 Tampines Central 1',
      lat: 1.3521, lng: 103.9434,
      lots: 200,
    },
    {
      code: 'HDB002',
      name: 'Bedok Mall Carpark',
      provider: 'HDB',
      address: '311 New Upper Changi Rd',
      lat: 1.3241, lng: 103.9308,
      lots: 350,
    },
    {
      code: 'URA001',
      name: 'Orchard Gateway Carpark',
      provider: 'URA',
      address: '277 Orchard Road',
      lat: 1.3048, lng: 103.8318,
      lots: 180,
    },
    {
      code: 'URA002',
      name: 'Marina Bay Sands Carpark',
      provider: 'URA',
      address: '10 Bayfront Avenue',
      lat: 1.2834, lng: 103.8607,
      lots: 500,
    },
    {
      code: 'MALL001',
      name: 'VivoCity Carpark',
      provider: 'MALL',
      address: '1 HarbourFront Walk',
      lat: 1.2648, lng: 103.8208,
      lots: 800,
    },
    {
      code: 'MALL002',
      name: 'Jewel Changi Carpark',
      provider: 'MALL',
      address: '78 Airport Boulevard',
      lat: 1.3644, lng: 103.9915,
      lots: 600,
    },
  ];

  for (const cp of sampleCarparks) {
    await db.query(
      `INSERT INTO carparks (
        carpark_code, name, provider, address, location, entrance_location,
        total_lots, lot_types, operating_hours, rate_schedule_id, is_active
      ) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
                ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, $8, $9, $10, true)
      ON CONFLICT (carpark_code) DO NOTHING`,
      [
        cp.code,
        cp.name,
        cp.provider,
        cp.address,
        cp.lng,
        cp.lat,
        cp.lots,
        JSON.stringify({ C: cp.lots }),
        JSON.stringify({ weekday: '07:00-23:00', saturday: '07:00-23:00', sunday: '08:00-22:00' }),
        rateScheduleId,
      ]
    );

    // Add initial availability
    await db.query(
      `INSERT INTO carpark_availability (carpark_id, available_lots, lot_type_breakdown, last_updated, source)
       SELECT id, $2, $3, NOW(), 'SEED'
       FROM carparks WHERE carpark_code = $1
       ON CONFLICT (carpark_id) DO UPDATE SET
         available_lots = EXCLUDED.available_lots,
         lot_type_breakdown = EXCLUDED.lot_type_breakdown,
         last_updated = EXCLUDED.last_updated`,
      [cp.code, Math.floor(cp.lots * 0.3), JSON.stringify({ C: Math.floor(cp.lots * 0.3) })]
    );
  }

  logger.info({ count: sampleCarparks.length }, 'Sample carparks inserted');
}

async function seedSampleERP(): Promise<void> {
  logger.info('Inserting authoritative ERP gantries from JSON...');

  // Load from the authoritative JSON with coordinates (project root on Render, /app in Docker)
  const fs = await import('fs');
  const path = await import('path');
  const fileURLToPath = (await import('url')).fileURLToPath;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.join(__dirname, '../..');
  
  const jsonPath = path.join(projectRoot, 'erp_gantry_rates_2026-09-07.json');
  
  if (!fs.existsSync(jsonPath)) {
    logger.error(`Authoritative JSON not found at ${jsonPath}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const gantries = data.gantries;

  // Load zone/bearing mapping
  const zoneMapPath = path.join(projectRoot, 'gantryZoneMap.json');
  let zoneMap: Record<string, { zoneId: string; bearing: number }> = {};
  if (fs.existsSync(zoneMapPath)) {
    zoneMap = JSON.parse(fs.readFileSync(zoneMapPath, 'utf-8'));
  }

  // Clear existing ERP data to ensure clean authoritative state
  await db.query('TRUNCATE TABLE erp_rate_tiers, erp_gantries RESTART IDENTITY CASCADE');

  // Coordinates for all gantries from seed_erp.sql (authoritative source)
  const GANTRY_COORDS: Record<number, {lat: number, lng: number}> = {
    1: { lat: 1.300404, lng: 103.855752 },
    2: { lat: 1.299633, lng: 103.861945 },
    3: { lat: 1.280421, lng: 103.840066 },
    4: { lat: 1.32041, lng: 103.968794 },
    5: { lat: 1.405011, lng: 103.855084 },
    6: { lat: 1.273307, lng: 103.844415 },
    7: { lat: 1.273002, lng: 103.843099 },
    9: { lat: 1.340191, lng: 103.972154 },
    10: { lat: 1.301291, lng: 103.854948 },
    11: { lat: 1.299621, lng: 103.856457 },
    12: { lat: 1.299254, lng: 103.841383 },
    13: { lat: 1.304795, lng: 103.83224 },
    14: { lat: 1.303526, lng: 103.83264 },
    15: { lat: 1.299514, lng: 103.839831 },
    16: { lat: 1.297949, lng: 103.857692 },
    17: { lat: 1.295998, lng: 103.859687 },
    18: { lat: 1.296217, lng: 103.862406 },
    19: { lat: 1.400498, lng: 103.861717 },
    20: { lat: 1.287802, lng: 103.842721 },
    21: { lat: 1.300568, lng: 103.843194 },
    22: { lat: 1.301622, lng: 103.841987 },
    23: { lat: 1.293, lng: 103.848 },
    24: { lat: 1.290048, lng: 103.842397 },
    25: { lat: 1.288699, lng: 103.844417 },
    26: { lat: 1.297703, lng: 103.843711 },
    27: { lat: 1.305698, lng: 103.837647 },
    28: { lat: 1.27442, lng: 103.860562 },
    29: { lat: 1.274645, lng: 103.850071 },
    30: { lat: 1.286, lng: 103.797 },
    31: { lat: 1.326, lng: 103.949 },
    32: { lat: 1.326321, lng: 103.870506 },
    33: { lat: 1.329084, lng: 103.864612 },
    34: { lat: 1.318356, lng: 103.851642 },
    35: { lat: 1.327, lng: 103.95 },
    36: { lat: 1.286743, lng: 103.796802 },
    37: { lat: 1.324506, lng: 103.859231 },
    38: { lat: 1.327605, lng: 103.828317 },
    39: { lat: 1.336294, lng: 103.837206 },
    40: { lat: 1.327247, lng: 103.868467 },
    41: { lat: 1.329679, lng: 103.952615 },
    42: { lat: 1.329006, lng: 103.864616 },
    43: { lat: 1.321577, lng: 103.823636 },
    44: { lat: 1.348894, lng: 103.963549 },
    45: { lat: 1.326222, lng: 103.870406 },
    46: { lat: 1.33978, lng: 103.950792 },
    47: { lat: 1.298025, lng: 103.847993 },
    48: { lat: 1.298737, lng: 103.848065 },
    49: { lat: 1.297733, lng: 103.846393 },
    50: { lat: 1.336646, lng: 103.94115 },
    51: { lat: 1.336299, lng: 103.940574 },
    52: { lat: 1.335209, lng: 103.9332 },
    53: { lat: 1.371288, lng: 103.94725 },
    54: { lat: 1.367336, lng: 103.946182 },
    55: { lat: 1.366963, lng: 103.947098 },
    56: { lat: 1.340921, lng: 103.853412 },
    57: { lat: 1.321941, lng: 103.872836 },
    58: { lat: 1.320148, lng: 103.871763 },
    59: { lat: 1.313665, lng: 103.870612 },
    60: { lat: 1.28939, lng: 103.847598 },
    61: { lat: 1.361885, lng: 103.944557 },
    62: { lat: 1.361324, lng: 103.962564 },
    63: { lat: 1.36064, lng: 103.960803 },
    64: { lat: 1.360404, lng: 103.961021 },
    65: { lat: 1.328564, lng: 103.911632 },
    66: { lat: 1.357562, lng: 103.962743 },
    67: { lat: 1.337, lng: 103.837 },
    68: { lat: 1.327, lng: 103.837 },
    69: { lat: 1.28543, lng: 103.860884 },
    70: { lat: 1.274, lng: 103.867 },
    71: { lat: 1.379181, lng: 103.933976 },
    72: { lat: 1.287, lng: 103.861 },
    73: { lat: 1.328, lng: 103.94 },
    74: { lat: 1.37517, lng: 103.91287 },
    80: { lat: 1.327658, lng: 103.967344 },
    90: { lat: 1.274991, lng: 103.867034 },
    91: { lat: 1.270654, lng: 103.856657 },
    92: { lat: 1.32898, lng: 103.912604 },
    93: { lat: 1.271052, lng: 103.856496 },
  };

  // Helper: compute tripwire as perpendicular LineString (~30m wide)
  // bearing: compass bearing (0=N, 90=E, 180=S, 270=W)
  // Returns WKT LineString in EPSG:4326
  function computeTripwire(lat: number, lng: number, bearing: number): string {
    // Tripwire is perpendicular to traffic flow: bearing +/- 90 degrees
    const perpBearing1 = (bearing + 90) % 360;
    const perpBearing2 = (bearing + 270) % 360;
    // Half-width ~15m (total ~30m)
    const halfWidthM = 15;
    // Use ST_Project via PostGIS: ST_Project(geog, distance, azimuth)
    // We'll construct the WKT directly using approximate degree offsets
    // 1 degree lat ~= 111km, 1 degree lng ~= 111km * cos(lat)
    const latRad = lat * Math.PI / 180;
    const metersPerDegLat = 111000;
    const metersPerDegLng = 111000 * Math.cos(latRad);
    
    const dLat1 = (halfWidthM * Math.cos(perpBearing1 * Math.PI / 180)) / metersPerDegLat;
    const dLng1 = (halfWidthM * Math.sin(perpBearing1 * Math.PI / 180)) / metersPerDegLng;
    const dLat2 = (halfWidthM * Math.cos(perpBearing2 * Math.PI / 180)) / metersPerDegLat;
    const dLng2 = (halfWidthM * Math.sin(perpBearing2 * Math.PI / 180)) / metersPerDegLng;
    
    const lng1 = lng + dLng1;
    const lat1 = lat + dLat1;
    const lng2 = lng + dLng2;
    const lat2 = lat + dLat2;
    
    return `SRID=4326;LINESTRING(${lng1} ${lat1}, ${lng2} ${lat2})`;
  }

  for (let i = 0; i < gantries.length; i++) {
    const g = gantries[i];
    const code = g.gantry_no.toString();
    const zoneKey = (i + 1).toString(); // zoneMap is indexed by array position (1-based)
    
    // Use individual gantry name (g.name) not the shared charging_point_name
    const specificName = g.name;

    // Road name mapping - check for expressway abbreviations in the specific name OR location
    // Priority: check full expressway names first, then abbreviations
    // For names like "PIE slip road into CTE", the road is PIE (starting road)
    // Also check location field for expressway exits (e.g., "Merchant Road/CTE Exit")
    const location = g.location || '';
    let road = 'Unknown';
    if (specificName.includes('Ayer Rajah Expressway') || specificName.includes('Citybound AYE') || specificName.includes('Tuasbound AYE') || specificName.includes('After North Buona Vista') || specificName.includes('After Jurong Town Hall') || location.includes('AYE')) {
      road = 'Ayer Rajah Expressway';
    } else if (specificName.includes('Central Expressway') || (specificName.includes('CTE') && !specificName.includes('PIE')) || location.includes('CTE')) {
      road = 'Central Expressway';
    } else if (specificName.includes('Pan Island Expressway') || specificName.includes('PIE') || specificName.includes('into CTE') || location.includes('PIE')) {
      // Names like "PIE slip road into CTE" are on PIE
      road = 'Pan Island Expressway';
    } else if (specificName.includes('Kallang-Paya Lebar Expressway') || specificName.includes('KPE') || location.includes('KPE')) {
      road = 'Kallang-Paya Lebar Expressway';
    } else if (specificName.includes('Marina Coastal Expressway') || specificName.includes('MCE') || location.includes('MCE')) {
      road = 'Marina Coastal Expressway';
    } else if (specificName.includes('East Coast Parkway') || specificName.includes('ECP') || location.includes('ECP')) {
      road = 'East Coast Parkway';
    } else if (g.section === 'Arterial Roads') road = 'Arterial Road';
    else if (g.section === 'Orchard Cordon and Rest of CBD') road = 'CBD';
    else if (g.section === 'Expressways') {
      // Default: extract road from charging_point_name for expressways
      const cpn = g.charging_point_name || '';
      if (cpn.includes('AYE')) road = 'Ayer Rajah Expressway';
      else if (cpn.includes('CTE')) road = 'Central Expressway';
      else if (cpn.includes('PIE')) road = 'Pan Island Expressway';
      else if (cpn.includes('KPE')) road = 'Kallang-Paya Lebar Expressway';
      else if (cpn.includes('MCE')) road = 'Marina Coastal Expressway';
      else if (cpn.includes('ECP')) road = 'East Coast Parkway';
    }

    // Use actual coordinates from JSON, with fallback for known gantries
    let lat = g.latitude;
    let lng = g.longitude;
    if (lat == null || lng == null) {
      const fallback = GANTRY_COORDS[g.gantry_no];
      if (fallback) {
        lat = fallback.lat;
        lng = fallback.lng;
      } else {
        // Default to center if missing
        lat = 1.3;
        lng = 103.8;
        logger.warn({ gantry: g.gantry_no }, 'Using default coordinates');
      }
    }

    // Determine direction based on name or section
    let direction = 'Unknown';
    const nameLower = specificName.toLowerCase();
    if (nameLower.includes('tuasbound') || nameLower.includes('tuas')) {
      direction = 'Tuasbound';
    } else if (nameLower.includes('citybound') || nameLower.includes('city')) {
      direction = 'Citybound';
    } else if (g.section.includes('Expressways')) {
      // Default to Citybound for expressways
      direction = 'Citybound';
    }

    // Get zoneId and bearing from mapping (use array index, not gantry number)
    const zoneInfo = zoneMap[zoneKey] || { zoneId: 'UNKNOWN', bearing: 0 };
    const zoneId = zoneInfo.zoneId;
    const bearing = zoneInfo.bearing;

    // Compute tripwire (perpendicular LineString ~30m wide)
    const tripwireWkt = computeTripwire(lat, lng, bearing);

    const res = await db.query(
      `INSERT INTO erp_gantries (gantry_code, name, location, road_name, direction, zone_id, bearing, tripwire, is_active)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, $7, $8, ST_GeomFromEWKT($9), true)
       RETURNING id`,
      [code, specificName, lng, lat, road, direction, zoneId, bearing, tripwireWkt]
    );

    const gantryId = res.rows[0].id;

    if (g.has_charges_in_this_edition && g.rates) {
      for (const rate of g.rates) {
        const days = rate.day_type === 'weekday' ? [1, 2, 3, 4, 5] : [6];
        for (const day of days) {
          await db.query(
            `INSERT INTO erp_rate_tiers (gantry_id, day_of_week, start_time, end_time, rate, is_active)
             VALUES ($1, $2, $3, $4, $5, true)
             ON CONFLICT (gantry_id, day_of_week, start_time, end_time) DO NOTHING`,
            [gantryId, day, rate.start, rate.end, rate.rate_sgd]
          );
        }
      }
    }
  }

  logger.info({ count: gantries.length }, 'Authoritative ERP data inserted from JSON');
}

async function seedFallbackERP(): Promise<void> {
  logger.info('Inserting fallback sample ERP gantries...');

  // Sample ERP gantries (major ones in Singapore)
  const sampleGantries = [
    {
      code: 'ERP01',
      name: 'AYE After Keppel Rd',
      road: 'AYE',
      direction: 'EB',
      lat: 1.2734, lng: 103.8156,
    },
    {
      code: 'ERP02',
      name: 'CTE After Braddell Rd',
      road: 'CTE',
      direction: 'SB',
      lat: 1.3374, lng: 103.8512,
    },
    {
      code: 'ERP03',
      name: 'PIE After Eunos Link',
      road: 'PIE',
      direction: 'EB',
      lat: 1.3221, lng: 103.9056,
    },
    {
      code: 'ERP04',
      name: 'KPE After Tampines Exp',
      road: 'KPE',
      direction: 'NB',
      lat: 1.3556, lng: 103.9234,
    },
    {
      code: 'ERP05',
      name: 'MCE After Straits Blvd',
      road: 'MCE',
      direction: 'EB',
      lat: 1.2834, lng: 103.8589,
    },
  ];

  for (const g of sampleGantries) {
    await db.query(
      `INSERT INTO erp_gantries (gantry_code, name, location, road_name, direction, is_active)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6, true)
       ON CONFLICT (gantry_code) DO NOTHING`,
      [g.code, g.name, g.lng, g.lat, g.road, g.direction]
    );
  }

  // Sample ERP rates (weekday peak hours)
  const gantryResult = await db.query('SELECT id, gantry_code FROM erp_gantries WHERE is_active = true');

  for (const g of gantryResult.rows) {
    const rates = [
      { day: 1, start: '07:30', end: '09:30', rate: 2.00 },
      { day: 2, start: '07:30', end: '09:30', rate: 2.00 },
      { day: 3, start: '07:30', end: '09:30', rate: 2.00 },
      { day: 4, start: '07:30', end: '09:30', rate: 2.00 },
      { day: 5, start: '07:30', end: '09:30', rate: 2.00 },
      { day: 1, start: '17:30', end: '19:30', rate: 2.50 },
      { day: 2, start: '17:30', end: '19:30', rate: 2.50 },
      { day: 3, start: '17:30', end: '19:30', rate: 2.50 },
      { day: 4, start: '17:30', end: '19:30', rate: 2.50 },
      { day: 5, start: '17:30', end: '19:30', rate: 2.50 },
      { day: 6, start: '09:00', end: '13:00', rate: 1.50 },
      { day: 0, start: '00:00', end: '23:59', rate: 0.00 },
    ];

    for (const r of rates) {
      await db.query(
        `INSERT INTO erp_rate_tiers (gantry_id, day_of_week, start_time, end_time, rate, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (gantry_id, day_of_week, start_time, end_time) DO NOTHING`,
        [g.id, r.day, r.start, r.end, r.rate]
      );
    }
  }

  logger.info({ gantries: gantryResult.rows.length }, 'Fallback ERP data inserted');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  await seed()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error({ err }, 'Seeding failed');
      process.exit(1);
    });
}