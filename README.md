# Manufacturing Upload & Ingestion API (Step 1)

Node.js/Express API for preserving customer files and transforming their upload and order details into a traceable `ManufacturingObject`. This repository previously contained only a Python package placeholder, project metadata, and an unconfigured Neon TypeScript config. The Python scaffold and existing `neon.ts` are retained; the new Node API is the active upload implementation.

## Run locally

Requirements: Node.js 20+.

```sh
npm install
cp .env.example .env
npm start
```

The default setup writes original files under `./uploads` and keeps structured upload records in memory. Set `DATABASE_URL` to use PostgreSQL. Apply versioned migrations before starting the API with `npm run db:migrate`; verify the connection and deployed schema with `npm run db:verify`. Migrations prefer `DATABASE_URL_UNPOOLED` when it is set. Set `STORAGE_BACKEND=s3` and the `S3_*` variables to use an S3-compatible bucket instead. Neon Object Storage can be used through its S3-compatible endpoint. Files are stored separately from structured database records.

`MAX_UPLOAD_BYTES` limits each request and file. Default: 50 MiB. Supported geometry uploads are STEP/STP, STL, OBJ, DXF, IGES/IGS. Technical documents currently accept PDF. Configure `API_KEY` to require `Authorization: Bearer <API_KEY>` on `/api/v1/uploads`; configure `ALLOWED_ORIGINS` as a comma-separated list for browser access.

## Pipeline and routes

`POST /api/v1/uploads` accepts `multipart/form-data` fields `geometry_files[]`, `documents[]`, `customer_id`, `project_name`, `description`, `quantity`, `material`, `tolerance`, `tolerance_unit`, `surface_finish`, `delivery_date`, and `notes`. It stores originals, creates an upload and asset records, runs available local extraction, compiles the requirements, and returns the ManufacturingObject with validation status. The detailed extraction stages can also be invoked independently:

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/v1/uploads` | Store files and form input, run available ingestion stages, return the ManufacturingObject |
| POST | `/api/v1/uploads/:uploadId/geometry/extract` | Re-run geometry extraction |
| POST | `/api/v1/uploads/:uploadId/documents/extract` | Re-run PDF text and explicit requirement extraction |
| POST | `/api/v1/uploads/:uploadId/order/extract` | Re-run structured order and explicit description parsing |
| POST | `/api/v1/uploads/:uploadId/compile` | Merge sources, detect conflicts/missing values, and compile the object |
| GET | `/api/v1/uploads/:uploadId/validation` | Return validation fields, issues, and the canonical object |
| GET | `/api/v1/uploads/:uploadId` | Return upload status and the current object |
| GET | `/api/v1/uploads/:uploadId/assets/:assetId/file` | Download the original file |

Example:

```sh
curl -X POST http://localhost:3000/api/v1/uploads \
  -F 'geometry_files[]=@motor_bracket.stl' \
  -F 'documents[]=@engineering_drawing.pdf' \
  -F 'customer_id=CUS-1042' \
  -F 'project_name=Motor Mount Redesign' \
  -F 'quantity=500' \
  -F 'material=Aluminum 6061-T6' \
  -F 'delivery_date=2026-11-15' \
  -F 'description=Bracket for supporting a 4 kg motor. The four mounting holes cannot move. Weight should be minimized.'
```

## Extraction behavior and limits

- Original files are stored before parsing. Parser failures are recorded against the asset and never overwrite the source file.
- STL and OBJ mesh parsers calculate a coordinate-space bounding box and triangle surface area. Volume is returned only when triangle edges form a consistently oriented closed mesh. Units are reported as unknown because those formats do not reliably declare them.
- STEP, DXF, and IGES files are preserved, but geometry measurements and feature recognition report `unavailable` until a real parser is configured. No holes, slots, manufacturing process, or part-family classification are invented.
- PDF text is extracted with `pdf-parse`. A small deterministic matcher recognizes explicitly labeled material, tolerance, and surface-finish text. Scanned PDFs need an OCR provider; none is configured.
- Structured order fields are marked `CONFIRMED` and linked to `customer_form`. Description parsing recognizes only explicit patterns such as “supports 4 kg”, fixed mounting holes, and minimizing weight. This is not an AI interpretation. `languageProvider` is an injectable interface for a future model; absent a provider, unrecognized language produces no requirements.
- Each normalized requirement keeps its source, confidence, and status. Multiple different values for a field become `CONFLICT` with candidates; absent values remain `MISSING`. The compiler does not select a winner.
- This step ends at ManufacturingObject and validation. It does not implement similarity, process planning, machine selection, costing, risk, pricing, or quote generation.

## PostgreSQL

Versioned SQL files live in `src/database/migrations`. `schema_migrations` records the applied filename and SHA-256 checksum. Structured records are split across `uploads`, `assets`, `geometry`, `manufacturing_features`, `shape_fingerprints`, `document_extractions`, `requirements`, `orders`, `functional_requirements`, `design_constraints`, `preferences`, and `validation_issues`. `raw_customer_input` stores the submitted form as source data. The canonical API object is assembled from these records and is not stored as one catch-all database value.

## Tests

```sh
npm test
```

After dependencies have been installed, the upload API tests exercise multipart and PDF paths. In a package-restricted environment, pure service tests can be run without external packages with `node --test test/services.test.js`.
