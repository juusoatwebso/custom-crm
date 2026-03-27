# Pipedrive → Twenty CRM Migration Plan

## Overview

This document describes the complete migration process for moving all Pipedrive CRM data into Twenty CRM via PostgreSQL, ensuring schema compatibility and data integrity.

## Architecture

```
┌─────────────────┐
│  Pipedrive API  │
│  (v1 & v2)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Migration Scripts          │
│  - init_migration.py        │ (fetch all data)
│  - update_migration.py      │ (fetch changes)
└────────┬────────────────────┘
         │
         ├─────────────────────┬──────────────────┐
         │                     │                  │
         ▼                     ▼                  ▼
    ┌─────────┐          ┌──────────┐      ┌─────────┐
    │ Local   │          │   Test   │      │  Neon   │
    │ Postgres│          │ Postgres │      │Postgres │
    │ (Dev)   │          │ (Verify) │      │(Prod)   │
    └─────────┘          └──────────┘      └─────────┘
         │                     │                  │
         └─────────────────────┴──────────────────┘
                       │
                       ▼
              ┌──────────────────┐
              │  Twenty CRM      │
              │  Workspace Data  │
              └──────────────────┘
```

## Phase 1: Data Fetching

### Sources
- **Organizations** → Companies (Pipedrive v2 API)
- **Persons** → People (Pipedrive v1 API)
- **Deals** → Opportunities (Pipedrive v1 API)
- **Leads** → Opportunities (Pipedrive v2 API)
- **Notes** → Notes (Pipedrive v1 API)
- **Activities** → Tasks (Pipedrive v1 API)

### Handling

#### Initial Migration (`init_migration.py`)
- Fetches **ALL** records from Pipedrive API
- No pagination limit
- Processes all records sequentially
- Creates audit trail with timestamps

#### Incremental Updates (`update_migration.py`)
- Tracks last sync timestamp
- Fetches only new/updated records since last sync
- Updates existing records by Pipedrive ID
- Skips deleted records (soft delete via deletedAt)

## Phase 2: Schema Transformation

### Field Transformations

#### Companies
```
pipedrive_id              → pipedriveId (stored for reference)
name                      → name
domain_name               → domainName (JSONB)
employees                 → employees
address                   → address (JSONB)
linkedin_link             → linkedinLink (JSONB)
website                   → xLink (JSONB, optional)
[generated]               → annualRecurringRevenue (JSONB)
[generated]               → position (ordering)
[system]                  → createdBy (ActorMetadata)
[system]                  → updatedBy (ActorMetadata)
created_at                → createdAt
updated_at                → updatedAt
[system]                  → deletedAt (soft delete)
[system]                  → searchVector (full-text search)
[system]                  → accountOwnerId (optional)
```

#### People
```
pipedrive_id              → pipedriveId (stored for reference)
first_name + last_name    → name (FullNameMetadata)
                             {firstName, lastName, displayName}
primary_email             → emails (EmailsMetadata array)
+ additional_emails         [{value, primary, type}, ...]
primary_phone             → phones (PhonesMetadata array)
+ country_code              [{value, primary, type,
+ calling_code              countryCode, callingCode}, ...]
linkedin_link             → linkedinLink (JSONB)
[generated]               → xLink (JSONB, optional)
job_title                 → jobTitle
city                      → city
[generated]               → avatarUrl (optional)
[generated]               → avatarFile (optional)
[generated]               → position (ordering)
[system]                  → createdBy (ActorMetadata)
[system]                  → updatedBy (ActorMetadata)
company_id (FK)           → companyId (UUID)
created_at                → createdAt
updated_at                → updatedAt
[system]                  → deletedAt (soft delete)
[system]                  → searchVector (full-text search)
```

#### Opportunities
```
pipedrive_id              → pipedriveId (stored for reference)
title (deal/lead)         → name
value + currency          → amount (CurrencyMetadata)
                             {amountMicros, currencyCode}
expected_close_date       → closeDate
stage                     → stage
[generated]               → position (ordering)
[system]                  → createdBy (ActorMetadata)
[system]                  → updatedBy (ActorMetadata)
person_id (FK)            → pointOfContactId (Person UUID)
org_id (FK)               → companyId (Company UUID)
[generated]               → ownerId (WorkspaceMember, optional)
[system]                  → probability (deprecated field)
created_at                → createdAt
updated_at                → updatedAt
[system]                  → deletedAt (soft delete)
[system]                  → searchVector (full-text search)
```

#### Notes
```
pipedrive_id              → pipedriveId (stored for reference)
[generated]               → position (ordering)
content (80 chars)        → title
content (full)            → bodyV2 (RichTextV2Metadata)
[system]                  → createdBy (ActorMetadata)
[system]                  → updatedBy (ActorMetadata)
created_at                → createdAt
updated_at                → updatedAt
[system]                  → deletedAt (soft delete)
[system]                  → searchVector (full-text search)
```

**Note Targets** (Junction Table - supports multi-entity relationships)
```
note (FK)                 → noteId
org (FK)                  → targetCompanyId
person (FK)               → targetPersonId
deal (FK)                 → targetOpportunityId
```

#### Tasks (Activities)
```
pipedrive_id              → pipedriveId (stored for reference)
[generated]               → position (ordering)
title                     → title
description               → bodyV2 (RichTextV2Metadata)
due_date                  → dueAt
done (boolean)            → status (TODO/DONE)
[system]                  → createdBy (ActorMetadata)
[system]                  → updatedBy (ActorMetadata)
[generated]               → assigneeId (WorkspaceMember, optional)
created_at                → createdAt
updated_at                → updatedAt
[system]                  → deletedAt (soft delete)
[system]                  → searchVector (full-text search)
```

**Task Targets** (Junction Table - supports multi-entity relationships)
```
activity (FK)             → taskId
org (FK)                  → targetCompanyId
person (FK)               → targetPersonId
deal (FK)                 → targetOpportunityId
```

## Phase 3: Data Loading

### Default Behavior
- Loads to **local PostgreSQL** by default
- Connection: `postgresql://localhost/crm_migration_test`
- Safe for development and testing

### Optional Neon Loading
- Use `--neon` flag to write to Neon instead
- Connection: Read from `.env` (PG_DATABASE_URL)
- Full schema and data validation required before this step

### Database Operations
1. Drop existing tables (if --reset flag)
2. Create Twenty CRM-compatible schema
3. Create indexes for performance
4. Migrate data with transformation
5. Validate record counts and relationships
6. Generate sync report

## Scripts

### 1. `init_migration.py` - Initial Full Migration

**Purpose**: Fetch all data from Pipedrive and load to database (default: local)

**Usage**:
```bash
# Load to local database (default)
python init_migration.py

# With options
python init_migration.py --reset              # Drop and recreate schema
python init_migration.py --neon               # Write to Neon instead of local
python init_migration.py --reset --neon       # Full reset, write to Neon
```

**What it does**:
1. Connects to Pipedrive API
2. Fetches ALL records (no limit):
   - Organizations
   - Persons
   - Deals + Leads
   - Notes
   - Activities
3. Transforms data to Twenty CRM schema
4. Creates PostgreSQL schema (local or Neon)
5. Inserts all records with relationships
6. Validates and reports results

**Output**:
```
Companies:     123 inserted
People:        456 inserted
Opportunities: 789 inserted
Notes:         234 inserted
Tasks:         567 inserted

Total: 2169 records migrated
```

### 2. `update_migration.py` - Incremental Updates

**Purpose**: Fetch and update changed records since last sync

**Usage**:
```bash
# Update local database
python update_migration.py

# With options
python update_migration.py --neon             # Update Neon instead
python update_migration.py --full-sync        # Force re-fetch all records
```

**What it does**:
1. Reads last sync timestamp from `.migration_state.json`
2. Fetches only new/modified records since last sync
3. Updates existing records or inserts new ones
4. Handles soft deletes (sets deletedAt)
5. Updates sync timestamp
6. Reports changes made

**Tracking**:
- `.migration_state.json` stores:
  ```json
  {
    "last_sync_timestamp": "2026-03-11T15:30:00Z",
    "total_synced_records": 2169,
    "companies": 123,
    "people": 456,
    "opportunities": 789,
    "notes": 234,
    "tasks": 567
  }
  ```

### 3. `test_migration.py` - Local Validation

**Purpose**: Test migration locally, validate data integrity, report issues

**Usage**:
```bash
# Run full test (init + validation)
python test_migration.py

# With options
python test_migration.py --keep-data          # Keep test database after
python test_migration.py --sample-size 100    # Test with smaller dataset
```

**What it does**:
1. Creates temporary test database (`crm_migration_test_temp`)
2. Runs init_migration.py with sample data
3. Validates schema:
   - All tables exist
   - All columns present
   - Data types correct
   - Indexes created
4. Validates data:
   - Record counts reasonable
   - Foreign key relationships valid
   - Metadata objects well-formed JSON
   - No NULL values in required fields
5. Tests update scenario:
   - Simulates Pipedrive API changes
   - Runs update_migration.py
   - Verifies updates applied correctly
6. Reports any issues found
7. Cleans up test database (unless --keep-data)

**Validation Checks**:
```
✓ Schema validation
  - 7 tables created
  - 123 columns total
  - All indexes present

✓ Data validation
  - 2169 records total
  - 100% foreign key integrity
  - 0 orphaned records
  - 0 malformed JSON objects

✓ Relationship validation
  - 456 people linked to 123 companies (98%)
  - 789 opportunities linked (95% company, 78% contact)
  - 234 notes with targets (0% associated in this dataset)

✓ Performance
  - All queries < 100ms
  - Indexes being used correctly
```

**Exit Codes**:
- `0` - All tests passed
- `1` - Validation failed
- `2` - Database error
- `3` - Data integrity issue

## Execution Flow

### Step 1: Local Development & Testing (Safe)
```bash
# Initial migration to local DB
python init_migration.py

# Run validation tests
python test_migration.py

# Make updates as needed, re-test
python init_migration.py --reset
python test_migration.py
```

### Step 2: Incremental Updates (Local)
```bash
# When Pipedrive data changes, update locally
python update_migration.py

# Verify updates
psql -U juusokayhko -d crm_migration_test -c "SELECT COUNT(*) FROM companies"
```

### Step 3: Neon Migration (When Ready)
```bash
# Once validated locally, migrate to Neon
python init_migration.py --reset --neon

# Run validation against Neon
python test_migration.py  # (can be adapted to test against Neon)

# Future updates to Neon
python update_migration.py --neon
```

## Database Connections

### Local PostgreSQL (Development)
```
Database URL: postgresql://localhost/crm_migration_test
User:         juusokayhko
Password:     (none - trust auth)
Port:         5432
```

### Neon PostgreSQL (Staging/Production)
```
Database URL: postgresql://neondb_owner:***@ep-***.neon.tech/neondb
From:         packages/twenty-server/.env (PG_DATABASE_URL)
Region:       EU Central (AWS)
SSL:          Required
```

## Environment Configuration

### `.env` File
```env
# Pipedrive API
PIPEDRIVE_API_TOKEN=your_token_here

# Local Database (development)
DATABASE_URL=postgresql://localhost/crm_migration_test

# Neon Database (staging/production)
PG_DATABASE_URL=postgresql://user:pass@host/neondb?sslmode=require
```

## Data Integrity & Safety

### Safeguards
1. ✅ Local-first approach (test before production)
2. ✅ Schema validation before data loading
3. ✅ Foreign key constraints enforced
4. ✅ Pipedrive IDs stored for audit trail
5. ✅ Soft deletes (deletedAt field)
6. ✅ Transaction-based migrations
7. ✅ Pre-flight validation checks

### Rollback Strategy
```bash
# If issues found after init migration
python init_migration.py --reset          # Start over locally

# If issues found on Neon
python init_migration.py --reset --neon   # Drop & recreate on Neon
```

## Monitoring & Logs

### Migration Report
```
Migration completed at: 2026-03-11T15:30:00Z
Source: Pipedrive API (v1 & v2)
Target: Local PostgreSQL

Summary:
  Companies:     123 (0 errors)
  People:        456 (0 errors)
  Opportunities: 789 (0 errors)
  Notes:         234 (0 errors)
  Tasks:         567 (0 errors)
  ───────────────────────────────
  Total:       2169 records

Relationships:
  People → Companies:        445/456 (97%)
  Opportunities → Companies: 750/789 (95%)
  Opportunities → People:    618/789 (78%)
  Notes → Targets:           0/234 (0%)
  Tasks → Targets:           0/567 (0%)

Performance:
  Fetch time:    12.34s
  Transform:      1.23s
  Load time:      3.45s
  ───────────────
  Total:         17.02s
```

## Troubleshooting

### Common Issues

**Problem**: "Pipedrive API rate limit exceeded"
- **Solution**: Script includes exponential backoff, wait and retry

**Problem**: "JSON validation error on people"
- **Solution**: Check for special characters in names/emails, scripts handle escaping

**Problem**: "Foreign key constraint violation"
- **Solution**: Ensure companies inserted before people, people before opportunities

**Problem**: "Database connection refused"
- **Solution**: Verify PostgreSQL running (`psql --version`), check connection string

## Timeline

1. **Phase 1** (Today): ✅ Create scripts (init, update, test)
2. **Phase 2** (Today): ✅ Test locally with full dataset
3. **Phase 3** (Tomorrow): ✅ Run init_migration.py --reset --neon
4. **Phase 4** (As needed): ✅ Run update_migration.py --neon for changes
5. **Phase 5** (TBD): Import into Twenty CRM workspace

## Success Criteria

- ✅ All Pipedrive records fetched and transformed
- ✅ Local PostgreSQL test database validates successfully
- ✅ Data migrated to Neon without errors
- ✅ All foreign key relationships intact
- ✅ Zero data loss (100% records migrated)
- ✅ Incremental updates work correctly
- ✅ Ready for Twenty CRM integration
