import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { cache } from '../cache/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import { oneMapService } from './oneMapService.js';
import polyline from '@mapbox/polyline';
import { lineString } from '@turf/turf';
import {
  estimateRouteTimings,
  findPassTimeForGantry,
  RouteStep,
  VertexPoint,
} from '../utils/estimateSpeed.js';

interface GantryResult {
  id: string;
  gantryCode: string;
  name: string;
  location: { lat: number; lng: number };
  distFromStartM: number; // Distance from route start in meters
  bearing?: number;        // Gantry bearing (traffic flow direction, 0-360)
  zoneId?: string;
  roadName?: string;       // Road name from OneMap instructions
}

interface GantryRate {
  gantryId: string;
  gantryCode: string;
  name: string;
  rate: number;
  arrivalTime?: string;      // ISO string of arrival at gantry
  appliedStartTime?: string; // Start of the rate interval applied
  rateGroup?: string;        // PDF rate group (e.g., "36", "52/53/74")
  roadName?: string;         // Road name from turn instructions
  rateBoundaryWarning?: boolean;
  adjacentRates?: {
    minus3Min: number;
    plus3Min: number;
  };
}

interface RouteERPCost {
  totalCost: number;
  gantries: GantryRate[];
  departureTime: Date;
  savings: {
    immediate: number;
    offPeak: number;
    offPeakTime: Date | null;
    offPeakWindow: string | null;
  };
}

interface DepartureWindow {
  label: string;
  time: Date;
  cost: number;
  savings: number;
}

class ERPService {
  // Get active ERP gantries intersecting a route via tripwire + bearing verification
  async getRouteGantries(
    routeGeometry: string,
    instructions?: Array<{ instruction: string; distance: number; duration: number; point: { lat: number; lng: number }; roadName?: string }>
  ): Promise<Array<{
    id: string;
    gantryCode: string;
    name: string;
    location: { lat: number; lng: number };
    distFromStartM: number;
    roadName?: string;
    dbRoadName?: string;
    dbType?: string;
    chargeType?: string;
  }>> {
    const cacheKey = `route:gantries:v2:${Buffer.from(routeGeometry).toString('base64').slice(0, 50)}`;
    const cached = await cache.get<GantryResult[]>(cacheKey);
    if (cached) return cached;

    try {
      logger.info({ hasInstructions: !!instructions, instructionCount: instructions?.length }, 'getRouteGantries called (tripwire + bearing)');
      
      // Decode OneMap polyline to coordinate array
      const routeCoords = this.decodePolylineToCoords(routeGeometry);
      if (routeCoords.length < 2) return [];
      
      // Build route LineString WKT for PostGIS
      const routeLineWkt = `SRID=4326;LINESTRING(${routeCoords.map(c => `${c[0]} ${c[1]}`).join(', ')})`;
      
      // Get total route length in meters
      const lengthResult = await db.query(
        `SELECT ST_Length(ST_GeomFromEWKT($1)::geography) as total_length`,
        [routeLineWkt]
      );
      const totalRouteLength = parseFloat(lengthResult.rows[0]?.total_length || '0');

      // Find gantries whose tripwire intersects the route LineString
      const result = await db.query(
        `SELECT id, gantry_code, name, zone_id, bearing,
                ST_Y(location::geometry) as lat,
                ST_X(location::geometry) as lng,
                tripwire,
                ST_LineLocatePoint(ST_GeomFromEWKT($1), location) * ST_Length(ST_GeomFromEWKT($1)::geography) as dist_from_start_m
         FROM erp_gantries
         WHERE is_active = true
           AND tripwire IS NOT NULL
           AND ST_Intersects(tripwire, ST_GeomFromEWKT($1))
         ORDER BY dist_from_start_m
         LIMIT 100`,
        [routeLineWkt]
      );

      if (result.rows.length === 0) {
        logger.info({ routeLineWkt }, 'No gantries found via tripwire intersection');
        await cache.set(cacheKey, [], 300);
        return [];
      }

      // Build turf LineString for bearing calculations
      const routeLine = lineString(routeCoords);
      
      // For each intersecting gantry, verify bearing match (±45°)
      const matchedGantries: GantryResult[] = [];
      
      for (const row of result.rows) {
        const gantryBearing = parseInt(row.bearing);
        const gantryLat = parseFloat(row.lat);
        const gantryLng = parseFloat(row.lng);
        
        // Find route segment bearing at the gantry's projection point
        const projectionResult = await db.query(
          `SELECT ST_LineLocatePoint(ST_GeomFromEWKT($1), location) as fraction
           FROM erp_gantries WHERE id = $2`,
          [routeLineWkt, row.id]
        );
        const fraction = parseFloat(projectionResult.rows[0]?.fraction || '0');
        
        // Get bearing of route segment at this fraction
        const routeBearing = this.getRouteBearingAtFraction(routeCoords, fraction);
        
        // Check bearing difference (±45° tolerance) - widened from 30° to handle curved expressway sections
        const bearingDiff = this.angleDifference(routeBearing, gantryBearing);
        if (bearingDiff > 45) {
          logger.debug({
            gantryCode: row.gantry_code,
            routeBearing: Math.round(routeBearing),
            gantryBearing,
            diff: Math.round(bearingDiff)
          }, 'Gantry filtered: bearing mismatch');
          continue;
        }
        
        matchedGantries.push({
          id: row.id,
          gantryCode: row.gantry_code,
          name: row.name,
          location: { lat: gantryLat, lng: gantryLng },
          distFromStartM: parseFloat(row.dist_from_start_m || '0'),
          bearing: gantryBearing,
          zoneId: row.zone_id,
        });
      }

      // Assign road names from instructions for display
      if (instructions && instructions.length > 0 && matchedGantries.length > 0) {
        this.assignRoadNames(matchedGantries, instructions, totalRouteLength);
      }

      logger.info({ gantries: matchedGantries.map(g => ({ code: g.gantryCode, bearing: g.bearing, zoneId: g.zoneId })) }, 'Tripwire + bearing matched gantries');
      
      await cache.set(cacheKey, matchedGantries, 300); // 5 min
      return matchedGantries;
    } catch (error) {
      logger.error({ error }, 'Failed to get route gantries');
      return [];
    }
  }

  // Decode OneMap polyline to [lng, lat] coordinate array
  private decodePolylineToCoords(encoded: string): number[][] {
    try {
      // @mapbox/polyline.decode returns [lat, lng] pairs
      const decoded = polyline.decode(encoded) as number[][];
      return decoded.map(([lat, lng]) => [lng, lat]);
    } catch {
      // Fallback: use custom decoder if polyline package fails
      const points = this.decodePolyline(encoded);
      return points.map(p => [p.lng, p.lat]);
    }
  }

  // Get route segment bearing at a given fraction (0-1) along the route
  private getRouteBearingAtFraction(routeCoords: number[][], fraction: number): number {
    if (routeCoords.length < 2) return 0;
    
    const totalSegments = routeCoords.length - 1;
    const targetIndex = Math.min(Math.floor(fraction * totalSegments), totalSegments - 1);
    
    const [lng1, lat1] = routeCoords[targetIndex];
    const [lng2, lat2] = routeCoords[targetIndex + 1];
    
    // Bearing from point 1 to point 2 (in degrees, 0=N, 90=E)
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
    
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    if (brng < 0) brng += 360;
    return brng;
  }

  // Absolute angle difference (0-180)
  private angleDifference(a: number, b: number): number {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
  }

  // Assign road names from OneMap instructions to matched gantries
  private assignRoadNames(
    gantries: GantryResult[],
    instructions: Array<{ instruction: string; distance: number; duration: number; point: { lat: number; lng: number }; roadName?: string }>,
    totalRouteLength: number
  ): void {
    // Build road segments from instructions
    let cumulativeDist = 0;
    const roadSegments: Array<{ roadName: string; startDist: number; endDist: number }> = [];

    for (const inst of instructions) {
      const roadName = inst.roadName || this.extractRoadName(inst.instruction);
      const segmentStart = cumulativeDist;
      const segmentEnd = cumulativeDist + inst.distance;
      
      // Merge with previous if same road
      const last = roadSegments[roadSegments.length - 1];
      if (last && last.roadName === roadName) {
        last.endDist = segmentEnd;
      } else {
        roadSegments.push({ roadName, startDist: segmentStart, endDist: segmentEnd });
      }
      cumulativeDist = segmentEnd;
    }

    // Assign road name to each gantry based on distance along route
    for (const gantry of gantries) {
      const segment = roadSegments.find(s =>
        gantry.distFromStartM >= s.startDist && gantry.distFromStartM < s.endDist
      );
      gantry.roadName = segment?.roadName || 'Unknown';
    }
  }

  // Extract road name from OneMap instruction text
  private extractRoadName(instruction: string): string {
    const patterns = [
      /(?:Merge|Keep|Turn|Head|Exit|Continue|Take)\s+(?:Right|Left|Straight)?\s*(?:Onto|On|Along)\s+(.+)/i,
      /(?:Merge|Keep|Turn|Head|Exit|Continue|Take)\s+.+?\s+On\s+(.+)/i,
    ];
    
    for (const pattern of patterns) {
      const match = instruction.match(pattern);
      if (match && match[1]) {
        return match[1].trim().replace(/\s+$/,'');
      }
    }
    return instruction.split(' ').slice(0, 4).join(' ');
  }

  // Simple polyline decoder (Google encoded polyline format) - fallback
  private decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
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

  // Calculate ERP cost for a route at a specific departure time (internal, no off-peak calc)
  private async calculateRouteCostInternal(
    gantries: Array<{
      id: string;
      gantryCode: string;
      name: string;
      location: { lat: number; lng: number };
      distFromStartM: number;
      roadName?: string;
    }>,
    departureTime: Date,
    routeGeometry?: string,
    routeDurationSeconds = 0,
    instructions?: Array<{ instruction: string; distance: number; duration: number; point: { lat: number; lng: number }; roadName?: string }>
  ): Promise<{ totalCost: number; gantries: GantryRate[] }> {
    const gantryIds = gantries.map(g => g.id);
    const cacheKey = `erp:cost:v2:${gantryIds.sort().join(',')}:${departureTime.toISOString().slice(0, 16)}:${routeGeometry ? Buffer.from(routeGeometry).toString('base64').slice(0, 50) : 'no-geom'}`;
    const cached = await cache.get<{ totalCost: number; gantries: GantryRate[] }>(cacheKey);
    if (cached) return cached;

    try {
      // Build route steps from OneMap instructions for speed model
      let steps: RouteStep[] = [];
      if (instructions && instructions.length > 0) {
        steps = instructions.map(inst => ({
          instruction: inst.instruction,
          distance: inst.distance,
          duration: inst.duration,
          roadName: inst.roadName || this.extractRoadName(inst.instruction),
          polyline: '', // OneMap doesn't provide per-step polylines, we'll use full route geometry
        }));
      } else if (routeGeometry) {
        // Fallback: single step with full route
        steps = [{
          instruction: 'Full route',
          distance: 0, // will be filled from route geometry
          roadName: 'Unknown',
          polyline: routeGeometry,
        }];
      }

      // If no instructions but have route geometry, decode it to get distance
      if (steps.length === 1 && steps[0].polyline && steps[0].distance === 0) {
        const points = this.decodePolyline(steps[0].polyline);
        let totalDist = 0;
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const dLat = (p2.lat - p1.lat) * 111000;
          const dLng = (p2.lng - p1.lng) * 111000 * Math.cos(p1.lat * Math.PI / 180);
          totalDist += Math.sqrt(dLat * dLat + dLng * dLng);
        }
        steps[0].distance = totalDist;
      }

      // Use offline speed model to compute vertex timestamps
      const { vertices } = estimateRouteTimings(
        [{ distance: steps.reduce((sum, s) => sum + s.distance, 0), duration: routeDurationSeconds, steps }],
        departureTime
      );

      // Find pass time for each gantry
      const arrivalTimes: Date[] = [];
      const matchedGantryIds: string[] = [];

      for (const g of gantries) {
        const match = findPassTimeForGantry(vertices, g.location.lat, g.location.lng, 50);
        if (match) {
          arrivalTimes.push(match.passTime);
          matchedGantryIds.push(g.id);
        }
      }

      // If no gantries matched via speed model, fall back to SQL linear interpolation
      if (arrivalTimes.length === 0 && routeGeometry) {
        return this.calculateRouteCostInternalLegacy(gantries, departureTime, routeGeometry, routeDurationSeconds);
      }

      // Look up rates with pre-computed arrival times + boundary check
      const result = await db.query(
        `SELECT * FROM lookup_erp_rates($1, $2)`,
        [matchedGantryIds, arrivalTimes]
      );

      // Create a map of gantryId -> roadName from the input gantries
      const roadNameMap = new Map(gantries.map(g => [g.id, g.roadName || 'Unknown']));

      const gantryRates: GantryRate[] = result.rows.map(r => {
        const roadName = roadNameMap.get(r.gantry_id) || 'Unknown';
        const minus3MinRate = r.minus_3min_rate !== null ? parseFloat(r.minus_3min_rate) : null;
        const plus3MinRate = r.plus_3min_rate !== null ? parseFloat(r.plus_3min_rate) : null;
        const boundaryWarning = minus3MinRate !== null && minus3MinRate !== r.rate
          || plus3MinRate !== null && plus3MinRate !== r.rate;

        return ({
          gantryId: r.gantry_id,
          gantryCode: r.gantry_code,
          name: r.name,
          rate: parseFloat(r.rate),
          arrivalTime: r.arrival_time ? new Date(r.arrival_time).toISOString() : departureTime.toISOString(),
          appliedStartTime: r.applied_start_time || undefined,
          rateGroup: ['52', '53', '74'].includes(r.gantry_code) ? '52/53/74' : r.gantry_code,
          roadName,
          rateBoundaryWarning: boundaryWarning,
          adjacentRates: boundaryWarning ? {
            minus3Min: minus3MinRate!,
            plus3Min: plus3MinRate!,
          } : undefined,
        });
      });

      // Only collapse gantries that LTA explicitly defines as one shared rate group.
      // Equal prices at unrelated gantries are separate charges.
      const byRateGroup = new Map<string, GantryRate>();
      for (const g of gantryRates) {
        const previous = byRateGroup.get(g.rateGroup || g.gantryCode);
        if (!previous || (g.arrivalTime || '') > (previous.arrivalTime || '')) {
          byRateGroup.set(g.rateGroup || g.gantryCode, g);
        }
      }
      const deduplicated = [...byRateGroup.values()].sort((a, b) =>
        (a.arrivalTime || '').localeCompare(b.arrivalTime || '')
      );

      const totalCost = deduplicated.reduce((sum, g) => sum + g.rate, 0);

      const cost = { totalCost, gantries: deduplicated };
      await cache.set(cacheKey, cost, 60);
      return cost;
    } catch (error) {
      logger.error({ error }, 'ERP cost calculation failed');
      throw AppError.internal('Failed to calculate ERP cost');
    }
  }

  // Legacy fallback using SQL linear interpolation
  private async calculateRouteCostInternalLegacy(
    gantries: Array<{
      id: string;
      gantryCode: string;
      name: string;
      location: { lat: number; lng: number };
      distFromStartM: number;
      roadName?: string;
    }>,
    departureTime: Date,
    routeGeometry?: string,
    routeDurationSeconds = 0
  ): Promise<{ totalCost: number; gantries: GantryRate[] }> {
    const gantryIds = gantries.map(g => g.id);
    const cacheKey = `erp:cost:legacy:${gantryIds.sort().join(',')}:${departureTime.toISOString().slice(0, 16)}:${routeDurationSeconds}:${routeGeometry ? Buffer.from(routeGeometry).toString('base64').slice(0, 50) : 'no-geom'}`;
    const cached = await cache.get<{ totalCost: number; gantries: GantryRate[] }>(cacheKey);
    if (cached) return cached;

    try {
      let routeLineWkt = null;
      if (routeGeometry) {
        const points = this.decodePolyline(routeGeometry);
        if (points.length >= 2) {
          const coords = points.map(p => `${p.lng} ${p.lat}`).join(', ');
          routeLineWkt = `SRID=4326;LINESTRING(${coords})`;
        }
      }

      let result;
      if (routeLineWkt) {
        result = await db.query(
          `SELECT * FROM calculate_erp_cost($1, $2, $3, $4)`,
          [gantryIds, departureTime, routeLineWkt, routeDurationSeconds]
        );
      } else {
        result = await db.query(
          `SELECT * FROM calculate_erp_cost($1, $2)`,
          [gantryIds, departureTime]
        );
      }

      const roadNameMap = new Map(gantries.map(g => [g.id, g.roadName || 'Unknown']));

      const gantryRates: GantryRate[] = result.rows.map(r => {
        const roadName = roadNameMap.get(r.gantry_id) || 'Unknown';
        return ({
          gantryId: r.gantry_id,
          gantryCode: r.gantry_code,
          name: r.name,
          rate: parseFloat(r.rate),
          arrivalTime: r.arrival_time ? new Date(r.arrival_time).toISOString() : departureTime.toISOString(),
          appliedStartTime: r.applied_start_time || r.applied_time || undefined,
          rateGroup: ['52', '53', '74'].includes(r.gantry_code) ? '52/53/74' : r.gantry_code,
          roadName,
        });
      });

      const byRateGroup = new Map<string, GantryRate>();
      for (const g of gantryRates) {
        const previous = byRateGroup.get(g.rateGroup || g.gantryCode);
        if (!previous || (g.arrivalTime || '') > (previous.arrivalTime || '')) {
          byRateGroup.set(g.rateGroup || g.gantryCode, g);
        }
      }
      const deduplicated = [...byRateGroup.values()].sort((a, b) =>
        (a.arrivalTime || '').localeCompare(b.arrivalTime || '')
      );

      const totalCost = deduplicated.reduce((sum, g) => sum + g.rate, 0);

      const cost = { totalCost, gantries: deduplicated };
      await cache.set(cacheKey, cost, 60);
      return cost;
    } catch (error) {
      logger.error({ error }, 'ERP cost calculation failed (legacy)');
      throw AppError.internal('Failed to calculate ERP cost');
    }
  }

  // Calculate ERP cost for a route at a specific departure time (public API with off-peak)
  async calculateRouteCost(
    gantries: Array<{
      id: string;
      gantryCode: string;
      name: string;
      location: { lat: number; lng: number };
      distFromStartM: number;
      roadName?: string;
    }>,
    departureTime: Date = new Date(),
    routeGeometry?: string,
    routeDurationSeconds = 0
  ): Promise<RouteERPCost> {
    const { totalCost, gantries: gantryRates } = await this.calculateRouteCostInternal(gantries, departureTime, routeGeometry, routeDurationSeconds);

    // Find next off-peak window
    const { offPeakCost, offPeakTime, offPeakWindow } = await this.findNextOffPeak(
      gantries,
      departureTime,
      routeGeometry,
      routeDurationSeconds,
      totalCost
    );

    return {
      totalCost,
      gantries: gantryRates,
      departureTime,
      savings: {
        immediate: totalCost,
        offPeak: offPeakCost,
        offPeakTime,
        offPeakWindow,
      },
    };
  }

  // Find the next off-peak window with lower ERP cost
  private async findNextOffPeak(
    gantries: Array<{
      id: string;
      gantryCode: string;
      name: string;
      location: { lat: number; lng: number };
      distFromStartM: number;
      roadName?: string;
    }>,
    fromTime: Date,
    routeGeometry?: string,
    routeDurationSeconds = 0,
    immediateCost = 0
  ): Promise<{ offPeakCost: number; offPeakTime: Date | null; offPeakWindow: string | null }> {
    // Check next 3 hours in 5-minute intervals (only future times from BOTH selected departure AND now)
    const windows: DepartureWindow[] = [];
    const interval = 5 * 60 * 1000; // 5 minutes
    const now = new Date();

    // Start from the later of: (selected departure + 5min) OR (now)
    const startTime = Math.max(fromTime.getTime() + interval, now.getTime());
    // Search until 3 hours after the later of (selected departure, now)
    const endTime = Math.max(fromTime.getTime(), now.getTime()) + 3 * 60 * 60 * 1000;

    for (let t = startTime; t < endTime; t += interval) {
      const checkTime = new Date(t);
      // Skip if checkTime is in the past (redundant but safe)
      if (checkTime <= now) continue;

      const { totalCost } = await this.calculateRouteCostInternal(gantries, checkTime, routeGeometry, routeDurationSeconds);
      windows.push({
        label: this.formatWindowLabel(checkTime),
        time: checkTime,
        cost: totalCost,
        savings: 0,
      });
    }

    // Find minimum cost window among future windows
    const minWindow = windows.length > 0
      ? windows.reduce((min, w) => w.cost < min.cost ? w : min, windows[0])
      : null;

    // Compare against actual immediate (leave now) cost, not first future window
    return {
      offPeakCost: minWindow?.cost ?? immediateCost,
      offPeakTime: minWindow && minWindow.cost < immediateCost ? minWindow.time : null,
      offPeakWindow: minWindow && minWindow.cost < immediateCost ? minWindow.label : null,
    };
  }

  // Get departure window options for UI
  async getDepartureWindows(
    gantries: Array<{
      id: string;
      gantryCode: string;
      name: string;
      location: { lat: number; lng: number };
      distFromStartM: number;
      roadName?: string;
    }>,
    fromTime: Date = new Date(),
    routeGeometry?: string,
    routeDurationSeconds = 0
  ): Promise<DepartureWindow[]> {
    const windows: DepartureWindow[] = [];
    const checkDuration = 60 * 60 * 1000; // 1 hour
    const interval = 5 * 60 * 1000; // 5 minutes

    for (let t = fromTime.getTime(); t < fromTime.getTime() + checkDuration; t += interval) {
      const checkTime = new Date(t);
      const { totalCost } = await this.calculateRouteCostInternal(gantries, checkTime, routeGeometry, routeDurationSeconds);
      windows.push({
        label: this.formatWindowLabel(checkTime),
        time: checkTime,
        cost: totalCost,
        savings: 0,
      });
    }

    // Calculate savings relative to immediate departure
    const immediateCost = windows[0].cost;
    windows.forEach(w => {
      w.savings = immediateCost - w.cost;
    });

    return windows;
  }

  // Format time window label for UI in Singapore time (e.g., "08:49")
  private formatWindowLabel(time: Date): string {
    return time.toLocaleTimeString('en-SG', { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false,
      timeZone: 'Asia/Singapore'
    });
  }

  // Get baseline ERP schedule for a gantry (fallback when live data unavailable)
  async getBaselineSchedule(gantryId: string): Promise<Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    rate: number;
  }>> {
    type BaselineResult = {
      dayOfWeek: number;
      startTime: string;
      endTime: string;
      rate: number;
    };
    const cacheKey = `erp:baseline:${gantryId}`;
    const cached = await cache.get<BaselineResult[]>(cacheKey);
    if (cached) return cached;

    try {
      const result = await db.query(
        `SELECT day_of_week, start_time, end_time, rate
         FROM erp_rate_tiers
         WHERE gantry_id = $1 AND is_active = true
         ORDER BY day_of_week, start_time`,
        [gantryId]
      );

      const schedule = result.rows.map(r => ({
        dayOfWeek: r.day_of_week,
        startTime: r.start_time,
        endTime: r.end_time,
        rate: parseFloat(r.rate),
      }));

      await cache.set(cacheKey, schedule, 3600);
      return schedule;
    } catch (error) {
      logger.error({ error, gantryId }, 'Failed to get baseline ERP schedule');
      return [];
    }
  }

  // Check if ERP tracking is available (for graceful degradation)
  async isTrackingAvailable(): Promise<boolean> {
    try {
      // Quick check - can we reach LTA?
      await db.query('SELECT 1 FROM erp_gantries WHERE is_active = true LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }
}

export const erpService = new ERPService();
