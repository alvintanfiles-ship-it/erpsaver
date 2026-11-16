/**
 * Offline Travel-Time Estimator for Singapore Routes
 * 
 * Computes step-by-step durations from route geometry without live traffic data.
 * Uses road-tier base speeds, Singapore time-of-day multipliers, and junction penalties.
 */

import { lineString, point, distance, bearing as turfBearing } from '@turf/turf';

// ============================================================================
// Types
// ============================================================================

export interface RouteStep {
  instruction: string;
  distance: number;        // meters
  duration?: number;       // seconds (from router, will be replaced)
  roadName?: string;
  polyline?: string;       // Google encoded polyline
  points?: Array<{ lat: number; lng: number }>;  // decoded vertices
}

export interface RouteLeg {
  distance: number;        // total meters
  duration: number;        // total seconds (sum of step durations)
  steps: RouteStep[];
}

export interface VertexPoint {
  lat: number;
  lng: number;
  cumulativeDistanceM: number;
  cumulativeTimeSec: number;
  timestamp: Date;         // absolute pass-through time
  roadName: string;
  roadTier: RoadTier;
}

export type RoadTier = 'expressway' | 'arterial' | 'ramp' | 'local';
export type DayType = 'weekday' | 'saturday' | 'sunday_ph';

export interface SpeedModelConfig {
  baseSpeedsKmh: Record<RoadTier, number>;
  peakMultipliers: Record<RoadTier, { weekday: { am: number; pm: number; day: number }; saturday: { day: number }; sunday_ph: number }>;
  junctionPenaltiesSec: { turn: number; straight: number; expresswayMerge: number };
  proximityThresholdM: number;
}

// ============================================================================
// Constants (Singapore-specific)
// ============================================================================

export const DEFAULT_CONFIG: SpeedModelConfig = {
  baseSpeedsKmh: {
    expressway: 80,
    arterial: 50,
    ramp: 40,
    local: 35,
  },
  peakMultipliers: {
    expressway: { weekday: { am: 0.60, pm: 0.55, day: 0.80 }, saturday: { day: 0.85 }, sunday_ph: 1.00 },
    arterial:   { weekday: { am: 0.55, pm: 0.50, day: 0.70 }, saturday: { day: 0.70 }, sunday_ph: 0.95 },
    ramp:       { weekday: { am: 0.50, pm: 0.45, day: 0.65 }, saturday: { day: 0.70 }, sunday_ph: 0.90 },
    local:      { weekday: { am: 0.50, pm: 0.45, day: 0.60 }, saturday: { day: 0.60 }, sunday_ph: 0.85 },
  },
  junctionPenaltiesSec: {
    turn: 20,
    straight: 5,
    expresswayMerge: 0,
  },
  proximityThresholdM: 15,
};

// ============================================================================
// Road Tier Detection
// ============================================================================

const EXPRESSWAY_KEYWORDS = [
  'expressway', 'aye', 'cte', 'pie', 'ecp', 'bke', 'sle', 'tpe', 'kje', 'mce', 'nsc',
  'keppel viaduct', 'kpe', 'seletar expressway', 'bukit timah expressway',
];

const ARTERIAL_KEYWORDS = [
  'avenue', 'boulevard', 'highway', 'queensway', 'orchard', 'victoria',
  'eu tong sen', 'shenton way', 'robinson', 'collyer', 'cecil', 'raffles',
  'stamford', 'hill', 'river valley', 'kim seng', 'havelock', 'lower delta',
  'alexandra', 'commonwealth', 'clementi', 'west coast', 'pasir panjang',
  'buona vista', 'portsdow', 'dover', 'kent ridge', 'science park',
  'ang mo kio', 'bishan', 'toapayoh', 'serangoon', 'hougang', 'sengkang',
  'punggol', 'tampines', 'bedok', 'changi', 'eunos', 'geylang', 'marine parade',
  'katong', 'siglap', 'east coast', 'still', 'stevens', 'dunearn', 'bukit timah',
  'upper bukit timah', 'woodlands', 'admiralty', 'sembawang', 'yishun', 'khatib',
  'jln', 'jalan', 'lorong', 'lor', 'link',
];

const RAMP_KEYWORDS = [
  'ramp', 'slip road', 'exit', 'merge', 'on-ramp', 'off-ramp', 'interchange',
  'flyover', 'underpass',
];

function normalizeRoadName(name: string): string {
  return name.toLowerCase().trim();
}

export function detectRoadTier(roadName: string, instruction: string = ''): RoadTier {
  const name = normalizeRoadName(roadName);
  const instr = normalizeRoadName(instruction);

  // Check expressway first (highest priority)
  for (const kw of EXPRESSWAY_KEYWORDS) {
    if (name.includes(kw) || instr.includes(kw)) {
      return 'expressway';
    }
  }

  // Check ramp
  for (const kw of RAMP_KEYWORDS) {
    if (name.includes(kw) || instr.includes(kw)) {
      return 'ramp';
    }
  }

  // Check arterial
  for (const kw of ARTERIAL_KEYWORDS) {
    if (name.includes(kw)) {
      return 'arterial';
    }
  }

  // Default to local
  return 'local';
}

// ============================================================================
// Time-of-Day Classification
// ============================================================================

export function getDayType(timestamp: Date): DayType {
  const sgTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const dayOfWeek = sgTime.getDay(); // 0 = Sun, 6 = Sat

  if (dayOfWeek === 0) return 'sunday_ph';
  if (dayOfWeek === 6) return 'saturday';
  return 'weekday';
}

export function getTimePeriod(timestamp: Date): 'am_peak' | 'pm_peak' | 'day' | 'night' {
  const sgTime = new Date(timestamp.toLocaleString('en-US', { timeZone: 'Asia/Singapore' }));
  const hour = sgTime.getHours();
  const minute = sgTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;

  // Weekday AM peak: 07:30 - 09:30 (450 - 570)
  if (timeInMinutes >= 450 && timeInMinutes < 570) return 'am_peak';
  // Weekday PM peak: 17:30 - 20:00 (1050 - 1200)
  if (timeInMinutes >= 1050 && timeInMinutes < 1200) return 'pm_peak';
  // Daytime: 09:30 - 17:30 (570 - 1050)
  if (timeInMinutes >= 570 && timeInMinutes < 1050) return 'day';
  // Night: 20:00 - 07:30
  return 'night';
}

function getMultiplier(roadTier: RoadTier, dayType: DayType, timePeriod: string, config = DEFAULT_CONFIG): number {
  const multipliers = config.peakMultipliers[roadTier];

  if (dayType === 'sunday_ph') {
    return multipliers.sunday_ph;
  }
  if (dayType === 'saturday') {
    return multipliers.saturday.day;
  }
  // weekday
  if (timePeriod === 'am_peak') return multipliers.weekday.am;
  if (timePeriod === 'pm_peak') return multipliers.weekday.pm;
  return multipliers.weekday.day;
}

// ============================================================================
// Junction Penalty
// ============================================================================

export function getJunctionPenalty(instruction: string, fromTier: RoadTier, toTier: RoadTier, config = DEFAULT_CONFIG): number {
  const instr = normalizeRoadName(instruction);

  // Expressway to expressway merge/split
  if (fromTier === 'expressway' && toTier === 'expressway') {
    if (instr.includes('merge') || instr.includes('keep') || instr.includes('continue')) {
      return config.junctionPenaltiesSec.expresswayMerge;
    }
  }

  // Turn onto new road
  if (instr.includes('turn left') || instr.includes('turn right') || instr.includes('u-turn')) {
    return config.junctionPenaltiesSec.turn;
  }

  // Continue straight / slight bend on non-expressway
  if (instr.includes('continue') || instr.includes('keep left') || instr.includes('keep right') || instr.includes('slight')) {
    return config.junctionPenaltiesSec.straight;
  }

  return config.junctionPenaltiesSec.straight;
}

// ============================================================================
// Polyline Decoding (Google encoded polyline)
// ============================================================================

export function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;

    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }

  return points;
}

// ============================================================================
// Core Duration Computation
// ============================================================================

export function computeStepDuration(
  step: RouteStep,
  departureTime: Date,
  prevTier: RoadTier | null,
  config = DEFAULT_CONFIG
): { durationSec: number; tier: RoadTier; endTime: Date } {
  const tier = detectRoadTier(step.roadName || '', step.instruction);
  const baseSpeedKmh = config.baseSpeedsKmh[tier];
  const baseSpeedMs = baseSpeedKmh * 1000 / 3600;

  const dayType = getDayType(departureTime);
  const timePeriod = getTimePeriod(departureTime);
  const multiplier = getMultiplier(tier, dayType, timePeriod, config);

  const effectiveSpeedMs = baseSpeedMs * multiplier;
  const travelTimeSec = step.distance / effectiveSpeedMs;

  const penaltySec = prevTier ? getJunctionPenalty(step.instruction, prevTier, tier, config) : 0;

  const totalSec = travelTimeSec + penaltySec;
  const endTime = new Date(departureTime.getTime() + totalSec * 1000);

  return { durationSec: totalSec, tier, endTime };
}

export function computeRouteDurations(
  steps: RouteStep[],
  departureTime: Date,
  config = DEFAULT_CONFIG
): { steps: RouteStep[]; totalDurationSec: number; totalDistanceM: number } {
  let currentTime = new Date(departureTime);
  let prevTier: RoadTier | null = null;
  let totalDuration = 0;
  let totalDistance = 0;

  const updatedSteps = steps.map(step => {
    const { durationSec, tier, endTime } = computeStepDuration(step, currentTime, prevTier, config);
    totalDuration += durationSec;
    totalDistance += step.distance;
    currentTime = endTime;
    prevTier = tier;

    return { ...step, duration: durationSec };
  });

  return { steps: updatedSteps, totalDurationSec: totalDuration, totalDistanceM: totalDistance };
}

// ============================================================================
// Vertex Interpolation (distribute step duration across polyline vertices)
// ============================================================================

export function interpolateVertices(
  steps: RouteStep[],
  departureTime: Date
): VertexPoint[] {
  const vertices: VertexPoint[] = [];
  let cumulativeDistance = 0;
  let cumulativeTime = 0;

  for (const step of steps) {
    const points = step.points || decodePolyline(step.polyline || '');
    if (points.length < 2) continue;

    // Calculate segment lengths
    const segments: Array<{ start: typeof points[0]; end: typeof points[0]; length: number }> = [];
    let stepDistance = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segLen = distance(point([p1.lng, p1.lat]), point([p2.lng, p2.lat]), { units: 'meters' });
      segments.push({ start: p1, end: p2, length: segLen });
      stepDistance += segLen;
    }

    if (stepDistance === 0) continue;

    const stepDuration = step.duration || 0;

    // Distribute time proportionally
    for (const seg of segments) {
      const fraction = seg.length / stepDistance;
      const segTime = stepDuration * fraction;

      cumulativeDistance += seg.length;
      cumulativeTime += segTime;

      const timestamp = new Date(departureTime.getTime() + cumulativeTime * 1000);

      vertices.push({
        lat: seg.end.lat,
        lng: seg.end.lng,
        cumulativeDistanceM: cumulativeDistance,
        cumulativeTimeSec: cumulativeTime,
        timestamp,
        roadName: step.roadName || 'Unknown',
        roadTier: detectRoadTier(step.roadName || '', step.instruction),
      });
    }
  }

  return vertices;
}

// ============================================================================
// High-level: Estimate full route with vertex timestamps
// ============================================================================

export function estimateRouteTimings(
  legs: RouteLeg[],
  departureTime: Date,
  config = DEFAULT_CONFIG
): {
  vertices: VertexPoint[];
  totalDistanceM: number;
  totalDurationSec: number;
  stepsWithDuration: RouteStep[];
} {
  // Combine all steps from all legs
  const allSteps: RouteStep[] = [];
  for (const leg of legs) {
    allSteps.push(...leg.steps);
  }

  // Compute step durations
  const { steps, totalDurationSec, totalDistanceM } = computeRouteDurations(allSteps, departureTime, config);

  // Decode polylines for vertex interpolation
  for (const step of steps) {
    if (step.polyline && !step.points) {
      step.points = decodePolyline(step.polyline);
    }
  }

  // Interpolate vertices
  const vertices = interpolateVertices(steps, departureTime);

  return { vertices, totalDistanceM, totalDurationSec, stepsWithDuration: steps };
}

// ============================================================================
// Helper: Find vertex closest to a gantry location
// ============================================================================

export function findPassTimeForGantry(
  vertices: VertexPoint[],
  gantryLat: number,
  gantryLng: number,
  maxDistanceM = 50
): { passTime: Date; vertexIndex: number; distanceM: number } | null {
  let best: { passTime: Date; vertexIndex: number; distanceM: number } | null = null;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    const d = distance(point([gantryLng, gantryLat]), point([v.lng, v.lat]), { units: 'meters' });
    if (d <= maxDistanceM) {
      if (!best || d < best.distanceM) {
        best = { passTime: v.timestamp, vertexIndex: i, distanceM: d };
      }
    }
  }

  return best;
}