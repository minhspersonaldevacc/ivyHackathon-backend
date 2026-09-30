CREATE TABLE uploads (
  upload_id TEXT PRIMARY KEY,
  customer_id TEXT,
  project_name TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'validated', 'needs_review', 'failed')),
  raw_customer_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  compiled_at TIMESTAMPTZ
);

CREATE TABLE assets (
  asset_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('geometry', 'technical_document')),
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  storage_uri TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored'
    CHECK (status IN ('stored', 'processing', 'processed', 'failed'))
);
CREATE INDEX assets_upload_id_idx ON assets(upload_id);
CREATE INDEX assets_sha256_idx ON assets(sha256);

CREATE TABLE geometry (
  geometry_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL UNIQUE REFERENCES assets(asset_id) ON DELETE CASCADE,
  dimensions JSONB,
  units TEXT,
  volume DOUBLE PRECISION CHECK (volume IS NULL OR volume >= 0),
  surface_area DOUBLE PRECISION CHECK (surface_area IS NULL OR surface_area >= 0),
  triangle_count INTEGER CHECK (triangle_count IS NULL OR triangle_count >= 0),
  watertight BOOLEAN,
  classification JSONB,
  feature_detection_status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (feature_detection_status IN ('available', 'unavailable', 'pending')),
  extraction_status TEXT NOT NULL
    CHECK (extraction_status IN ('extracted', 'unavailable', 'failed')),
  source JSONB NOT NULL,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  notice TEXT
);
CREATE INDEX geometry_upload_id_idx ON geometry(upload_id);

CREATE TABLE manufacturing_features (
  feature_id TEXT PRIMARY KEY,
  geometry_id TEXT NOT NULL REFERENCES geometry(geometry_id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1)
);
CREATE INDEX manufacturing_features_geometry_id_idx ON manufacturing_features(geometry_id);

CREATE TABLE shape_fingerprints (
  fingerprint_id TEXT PRIMARY KEY,
  geometry_id TEXT NOT NULL UNIQUE REFERENCES geometry(geometry_id) ON DELETE CASCADE,
  planar_ratio DOUBLE PRECISION CHECK (planar_ratio IS NULL OR planar_ratio BETWEEN 0 AND 1),
  curved_surface_ratio DOUBLE PRECISION CHECK (curved_surface_ratio IS NULL OR curved_surface_ratio BETWEEN 0 AND 1),
  bounding_box_fill DOUBLE PRECISION CHECK (bounding_box_fill IS NULL OR bounding_box_fill BETWEEN 0 AND 1),
  critical_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  embedding DOUBLE PRECISION[] NOT NULL DEFAULT '{}'
);

CREATE TABLE document_extractions (
  asset_id TEXT PRIMARY KEY REFERENCES assets(asset_id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('extracted', 'unavailable', 'failed')),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  extracted_text TEXT,
  reason TEXT
);

CREATE TABLE requirements (
  requirement_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value JSONB,
  unit TEXT,
  source JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'EXTRACTED', 'LOW_CONFIDENCE', 'MISSING', 'CONFLICT', 'NOT_APPLICABLE'))
);
CREATE INDEX requirements_upload_field_idx ON requirements(upload_id, field);
CREATE INDEX requirements_status_idx ON requirements(status);

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL UNIQUE REFERENCES uploads(upload_id) ON DELETE CASCADE,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  quantity_source TEXT NOT NULL,
  quantity_confidence DOUBLE PRECISION NOT NULL CHECK (quantity_confidence BETWEEN 0 AND 1),
  delivery_date DATE,
  delivery_source TEXT NOT NULL,
  delivery_confidence DOUBLE PRECISION NOT NULL CHECK (delivery_confidence BETWEEN 0 AND 1),
  notes TEXT,
  description TEXT,
  interpretation_provider TEXT NOT NULL
);

CREATE TABLE functional_requirements (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL,
  value JSONB,
  unit TEXT,
  source TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX functional_requirements_upload_idx ON functional_requirements(upload_id);

CREATE TABLE design_constraints (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  constraint_type TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX design_constraints_upload_idx ON design_constraints(upload_id);

CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  priority TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1)
);
CREATE INDEX preferences_upload_idx ON preferences(upload_id);

CREATE TABLE validation_issues (
  issue_id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES uploads(upload_id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  issue_type TEXT NOT NULL CHECK (issue_type IN ('missing', 'conflict', 'low_confidence', 'invalid')),
  severity TEXT NOT NULL CHECK (severity IN ('blocking', 'review', 'info')),
  status TEXT NOT NULL CHECK (status IN ('open', 'unresolved', 'resolved')),
  candidates JSONB
);
CREATE INDEX validation_issues_upload_idx ON validation_issues(upload_id);
CREATE INDEX validation_issues_open_idx ON validation_issues(upload_id, severity) WHERE status <> 'resolved';

CREATE INDEX uploads_created_at_idx ON uploads(created_at DESC);
CREATE INDEX uploads_status_idx ON uploads(status);
