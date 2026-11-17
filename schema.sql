-- ParkERP Database Schema
-- Requires PostgreSQL 14+ with PostGIS 3.3+
-- Run: psql -d parkerp -f schema.sql

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum types
CREATE TYPE carpark_provider AS ENUM ('HDB', 'URA', 'MALL');
CREATE TYPE erp_gantry_type AS ENUM ('GANTRY', 'CORDON');
CREATE TYPE parking_status AS ENUM ('AVAILABLE', 'FILLING_UP', 'CRITICAL', 'UNKNOWN');

-- Carparks table with PostGIS geometry
CREATE TABLE carparks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    carpark_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    provider carpark_provider NOT NULL,
    address TEXT,
    -- PostGIS Point geometry (WGS84 / EPSG:4326)
    location GEOMETRY(Point, 4326) NOT NULL,
    -- Entrance coordinate (may differ from centroid)
    entrance_location GEOMETRY(Point, 4326),
    -- Total capacity
    total_lots INTEGER NOT NULL DEFAULT 0,
    -- Lot type breakdown (JSON)
    lot_types JSONB DEFAULT '{}',
    -- Operating hours (JSON: { "weekday": "07:00-23:00", "saturday": "07:00-23:00", "sunday": "08:00-22:00" })
    operating_hours JSONB,
    -- Rate schedule reference
    rate_schedule_id UUID,
    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Rate schedules for parking fees
CREATE TABLE rate_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    -- Rate structure as JSON:
    -- {
    --   "base_rate": { "weekday": 1.20, "saturday": 1.20, "sunday": 0.60 },
    --   "per_half_hour": { "weekday": 0.60, "saturday": 0.60, "sunday": 0.30 },
    --   "max_daily": { "weekday": 10.00, "saturday": 10.00, "sunday": 5.00 },
    --   "night_parking": { "start": "22:00", "end": "07:00", "rate": 2.00 },
    --   "grace_period_minutes": 10
    -- }
    rate_json JSONB NOT NULL,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Live carpark availability (cached from URA/HDB APIs, 60s TTL)
CREATE TABLE carpark_availability (
    carpark_id UUID PRIMARY KEY REFERENCES carparks(id) ON DELETE CASCADE,
    available_lots INTEGER NOT NULL DEFAULT 0,
    lot_type_breakdown JSONB DEFAULT '{}',
    -- Status derived from available_lots
    status parking_status GENERATED ALWAYS AS (
        CASE
            WHEN available_lots > 20 THEN 'AVAILABLE'::parking_status
            WHEN available_lots >= 5 THEN 'FILLING_UP'::parking_status
            ELSE 'CRITICAL'::parking_status
        END
    ) STORED,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(50) NOT NULL, -- 'URA', 'HDB', 'MALL_API'
    -- is_stale computed in queries: last_updated < NOW() - INTERVAL '2 minutes'
    -- Cannot be a GENERATED column because NOW() is not immutable
    is_stale BOOLEAN GENERATED ALWAYS AS (false) STORED
);

-- ERP Gantries
CREATE TABLE erp_gantries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gantry_code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    type erp_gantry_type NOT NULL DEFAULT 'GANTRY',
    location GEOMETRY(Point, 4326) NOT NULL,
    -- Road name and direction
    road_name VARCHAR(255),
    direction VARCHAR(50), -- 'N', 'S', 'E', 'W', 'NB', 'SB', etc.
    -- LTA ZoneID mapping for rate lookup
    zone_id VARCHAR(20),
    -- Compass bearing (0-360) for directional filtering
    bearing SMALLINT CHECK (bearing >= 0 AND bearing <= 360),
    -- Perpendicular tripwire LineString for precise intersection detection
    tripwire GEOMETRY(LineString, 4326),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ERP Rate Tiers (seasonal/time-based pricing)
CREATE TABLE erp_rate_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gantry_id UUID NOT NULL REFERENCES erp_gantries(id) ON DELETE CASCADE,
    -- Time window: day of week (0-6, 0=Sunday) + start/end time
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    -- Rate in SGD
    rate DECIMAL(6,2) NOT NULL,
    -- Seasonal validity (optional)
    season_start DATE,
    season_end DATE,
    -- Metadata
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(gantry_id, day_of_week, start_time, end_time)
);

-- ERP Routes (pre-computed common routes for quick lookup)
CREATE TABLE erp_routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    origin_lat DECIMAL(10,7) NOT NULL,
    origin_lng DECIMAL(10,7) NOT NULL,
    dest_lat DECIMAL(10,7) NOT NULL,
    dest_lng DECIMAL(10,7) NOT NULL,
    -- Ordered list of gantry IDs this route passes through
    gantry_ids UUID[] NOT NULL DEFAULT '{}',
    -- Estimated travel time in minutes (baseline)
    baseline_duration_min INTEGER,
    distance_km DECIMAL(6,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences (for future personalization)
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(100) UNIQUE NOT NULL, -- device ID or auth user ID
    preferred_theme VARCHAR(20) DEFAULT 'auto', -- 'light', 'dark', 'auto'
    speed_lockout_enabled BOOLEAN DEFAULT true,
    speed_lockout_threshold_kmh INTEGER DEFAULT 15,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for spatial queries
CREATE INDEX idx_carparks_location ON carparks USING GIST (location);
CREATE INDEX idx_carparks_entrance ON carparks USING GIST (entrance_location);
CREATE INDEX idx_carparks_provider ON carparks (provider);
CREATE INDEX idx_carparks_active ON carparks (is_active);
CREATE INDEX idx_erp_gantries_location ON erp_gantries USING GIST (location);
CREATE INDEX idx_erp_gantries_tripwire ON erp_gantries USING GIST (tripwire);
CREATE INDEX idx_erp_gantries_active ON erp_gantries (is_active);
CREATE INDEX idx_erp_rate_tiers_gantry ON erp_rate_tiers (gantry_id, day_of_week, start_time, end_time);
CREATE INDEX idx_carpark_availability_updated ON carpark_availability (last_updated);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_carparks_updated_at BEFORE UPDATE ON carparks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rate_schedules_updated_at BEFORE UPDATE ON rate_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_erp_gantries_updated_at BEFORE UPDATE ON erp_gantries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_erp_rate_tiers_updated_at BEFORE UPDATE ON erp_rate_tiers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_erp_routes_updated_at BEFORE UPDATE ON erp_routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to find nearby carparks within radius (meters)
CREATE OR REPLACE FUNCTION find_nearby_carparks(
    center_lat DOUBLE PRECISION,
    center_lng DOUBLE PRECISION,
    radius_meters INTEGER DEFAULT 1000,
    provider_filter carpark_provider[] DEFAULT NULL,
    min_lots INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    carpark_code VARCHAR(20),
    name VARCHAR(255),
    provider carpark_provider,
    address TEXT,
    distance_meters DOUBLE PRECISION,
    total_lots INTEGER,
    available_lots INTEGER,
    status parking_status,
    rate_schedule_id UUID,
    operating_hours JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.carpark_code,
        c.name,
        c.provider,
        c.address,
        ST_Distance(
            c.location::geography,
            ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography
        ) AS distance_meters,
        c.total_lots,
        COALESCE(ca.available_lots, 0) AS available_lots,
        COALESCE(ca.status, 'UNKNOWN'::parking_status) AS status,
        c.rate_schedule_id,
        c.operating_hours
    FROM carparks c
    LEFT JOIN carpark_availability ca ON ca.carpark_id = c.id
    WHERE c.is_active = true
        AND ST_DWithin(
            c.location::geography,
            ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
            radius_meters
        )
        AND (provider_filter IS NULL OR c.provider = ANY(provider_filter))
        AND COALESCE(ca.available_lots, 0) >= min_lots
    ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate ERP cost for a route at a given departure time
CREATE OR REPLACE FUNCTION calculate_erp_cost(
    route_gantry_ids UUID[],
    departure_time TIMESTAMPTZ
)
RETURNS TABLE (
    gantry_id UUID,
    gantry_code VARCHAR(20),
    gantry_name VARCHAR(255),
    rate DECIMAL(6,2),
    day_of_week SMALLINT,
    applied_time TIME
) AS $$
DECLARE
    sg_time TIMESTAMP := departure_time AT TIME ZONE 'Asia/Singapore';
    dow SMALLINT := EXTRACT(DOW FROM sg_time)::SMALLINT;
    dep_time TIME := sg_time::TIME;
BEGIN
    RETURN QUERY
    SELECT
        ert.gantry_id,
        eg.gantry_code,
        eg.name,
        ert.rate,
        ert.day_of_week,
        ert.start_time AS applied_time
    FROM erp_rate_tiers ert
    JOIN erp_gantries eg ON eg.id = ert.gantry_id
    WHERE ert.gantry_id = ANY(route_gantry_ids)
        AND ert.day_of_week = dow
        AND ert.start_time <= dep_time
        AND ert.end_time > dep_time
        AND ert.is_active = true
        AND eg.is_active = true
        AND (ert.season_start IS NULL OR ert.season_start <= sg_time::DATE)
        AND (ert.season_end IS NULL OR ert.season_end >= sg_time::DATE)
    ORDER BY ert.gantry_id;
END;
$$ LANGUAGE plpgsql;

-- Calculate each gantry's rate at its estimated arrival time along the chosen route.
CREATE OR REPLACE FUNCTION calculate_erp_cost(
    route_gantry_ids UUID[],
    departure_time TIMESTAMPTZ,
    route_line_wkt TEXT,
    route_duration_seconds DOUBLE PRECISION
)
RETURNS TABLE (
    gantry_id UUID,
    gantry_code VARCHAR(20),
    gantry_name VARCHAR(255),
    rate DECIMAL(6,2),
    day_of_week SMALLINT,
    applied_start_time TIME,
    arrival_time TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    WITH route AS (
        SELECT ST_GeomFromEWKT(route_line_wkt) AS line
    ), arrivals AS (
        SELECT eg.id,
               departure_time + make_interval(secs =>
                   route_duration_seconds * ST_LineLocatePoint(route.line, eg.location)
               ) AS reached_at
        FROM erp_gantries eg
        CROSS JOIN route
        WHERE eg.id = ANY(route_gantry_ids)
          AND eg.is_active = true
    ), local_arrivals AS (
        SELECT id, reached_at,
               reached_at AT TIME ZONE 'Asia/Singapore' AS reached_sg
        FROM arrivals
    )
    SELECT eg.id,
           eg.gantry_code,
           eg.name,
           ert.rate,
           EXTRACT(DOW FROM la.reached_sg)::SMALLINT,
           ert.start_time,
           la.reached_at
    FROM local_arrivals la
    JOIN erp_gantries eg ON eg.id = la.id
    JOIN erp_rate_tiers ert ON ert.gantry_id = eg.id
    WHERE ert.day_of_week = EXTRACT(DOW FROM la.reached_sg)::SMALLINT
      AND ert.start_time <= la.reached_sg::TIME
      AND ert.end_time > la.reached_sg::TIME
      AND ert.is_active = true
      AND (ert.season_start IS NULL OR ert.season_start <= la.reached_sg::DATE)
      AND (ert.season_end IS NULL OR ert.season_end >= la.reached_sg::DATE)
    ORDER BY la.reached_at, eg.gantry_code;
END;
$$ LANGUAGE plpgsql;

-- Function to look up ERP rates for specific gantries at specific arrival times
-- Returns rates with boundary check (±3 min rates) for UI warnings
CREATE OR REPLACE FUNCTION lookup_erp_rates(
    route_gantry_ids UUID[],
    arrival_times TIMESTAMPTZ[]
)
RETURNS TABLE (
    gantry_id UUID,
    gantry_code VARCHAR(20),
    gantry_name VARCHAR(255),
    rate DECIMAL(6,2),
    day_of_week SMALLINT,
    applied_start_time TIME,
    arrival_time TIMESTAMPTZ,
    minus_3min_rate DECIMAL(6,2),
    plus_3min_rate DECIMAL(6,2)
) AS $$
DECLARE
    v_i INTEGER;
    v_gantry_id UUID;
    v_arrival TIMESTAMPTZ;
    v_sg_time TIMESTAMP;
    v_dow SMALLINT;
    v_dep_time TIME;
    v_rate DECIMAL(6,2);
    v_minus3 DECIMAL(6,2);
    v_plus3 DECIMAL(6,2);
    v_start_time TIME;
BEGIN
    FOR v_i IN 1..array_length(route_gantry_ids, 1) LOOP
        v_gantry_id := route_gantry_ids[v_i];
        v_arrival := arrival_times[v_i];
        v_sg_time := v_arrival AT TIME ZONE 'Asia/Singapore';
        v_dow := EXTRACT(DOW FROM v_sg_time)::SMALLINT;
        v_dep_time := v_sg_time::TIME;
        
        -- Find the active rate tier for this gantry at this time
        SELECT ert.rate, ert.start_time,
               (SELECT rate FROM erp_rate_tiers 
                WHERE gantry_id = v_gantry_id 
                  AND day_of_week = v_dow 
                  AND start_time <= (v_dep_time - INTERVAL '3 minutes')::TIME
                  AND end_time > (v_dep_time - INTERVAL '3 minutes')::TIME
                  AND is_active = true
                  AND (season_start IS NULL OR season_start <= v_sg_time::DATE)
                  AND (season_end IS NULL OR season_end >= v_sg_time::DATE)
                ORDER BY start_time DESC LIMIT 1),
               (SELECT rate FROM erp_rate_tiers 
                WHERE gantry_id = v_gantry_id 
                  AND day_of_week = v_dow 
                  AND start_time <= (v_dep_time + INTERVAL '3 minutes')::TIME
                  AND end_time > (v_dep_time + INTERVAL '3 minutes')::TIME
                  AND is_active = true
                  AND (season_start IS NULL OR season_start <= v_sg_time::DATE)
                  AND (season_end IS NULL OR season_end >= v_sg_time::DATE)
                ORDER BY start_time DESC LIMIT 1)
        INTO v_rate, v_start_time, v_minus3, v_plus3
        FROM erp_rate_tiers ert
        JOIN erp_gantries eg ON eg.id = ert.gantry_id
        WHERE ert.gantry_id = v_gantry_id
          AND ert.day_of_week = v_dow
          AND ert.start_time <= v_dep_time
          AND ert.end_time > v_dep_time
          AND ert.is_active = true
          AND eg.is_active = true
          AND (ert.season_start IS NULL OR ert.season_start <= v_sg_time::DATE)
          AND (ert.season_end IS NULL OR ert.season_end >= v_sg_time::DATE)
        ORDER BY ert.start_time DESC
        LIMIT 1;
        
        IF FOUND THEN
            RETURN NEXT;
        END IF;
    END LOOP;
    RETURN;
END;
$$ LANGUAGE plpgsql;
