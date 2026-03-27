# Twenty CRM Data Model — In-Depth Guide

This document covers how Twenty structures its data, how the timeline/activity history works, and what's achievable when migrating from Pipedrive.

---

## Table of Contents

1. [Core Object Model](#1-core-object-model)
2. [Composite (Structured) Field Types](#2-composite-structured-field-types)
3. [Relationships & Junction Tables](#3-relationships--junction-tables)
4. [Timeline & Activity History](#4-timeline--activity-history)
5. [Audit Trail Fields](#5-audit-trail-fields)
6. [Replicating Pipedrive's History Timeline](#6-replicating-pipedrives-history-timeline)
7. [Migration Mapping: Pipedrive → Twenty](#7-migration-mapping-pipedrive--twenty)
8. [Custom Fields & Extensibility](#8-custom-fields--extensibility)
9. [What Can and Cannot Be Replicated](#9-what-can-and-cannot-be-replicated)
10. [Recommended Migration Strategy](#10-recommended-migration-strategy)

---

## 1. Core Object Model

Every Twenty workspace entity extends `BaseWorkspaceEntity`, which provides:

| Field        | Type        | Description                                  |
|--------------|-------------|----------------------------------------------|
| `id`         | UUID        | Primary key                                  |
| `createdAt`  | timestamp   | Row creation time (auto-set)                 |
| `updatedAt`  | timestamp   | Last update time (auto-set)                  |
| `deletedAt`  | timestamp   | Soft-delete marker (null = active)           |
| `position`   | float       | Display order within lists/boards            |

### Company

```
id, name, employees, idealCustomerProfile
domainName (LinksMetadata)
linkedinLink (LinksMetadata)
xLink (LinksMetadata)
annualRecurringRevenue (CurrencyMetadata)
address (AddressMetadata)
createdBy (ActorMetadata)
updatedBy (ActorMetadata)
searchVector (tsvector — full-text search)

→ people[]
→ opportunities[]
→ taskTargets[]       (junction to Tasks)
→ noteTargets[]       (junction to Notes)
→ attachments[]
→ timelineActivities[]
→ favorites[]
→ accountOwner (WorkspaceMember)
```

### Person

```
id, jobTitle, city
name (FullNameMetadata: firstName, lastName)
emails (EmailsMetadata: primary + additionalEmails[])
phones (PhonesMetadata: primary + additionalPhones[])
linkedinLink, xLink (LinksMetadata)
avatarFile (FileOutput[])
createdBy, updatedBy (ActorMetadata)

→ company (many-to-one)
→ pointOfContactForOpportunities[]
→ taskTargets[], noteTargets[]
→ attachments[], timelineActivities[], favorites[]
→ messageParticipants[]     (email integration)
→ calendarEventParticipants[]  (calendar integration)
```

### Opportunity (Deal)

```
id, name, closeDate, stage, position
amount (CurrencyMetadata: amountMicros, currencyCode)
createdBy, updatedBy (ActorMetadata)

Stages (default): NEW, QUALIFIED, WON, LOST

→ company (many-to-one)
→ pointOfContact: Person (many-to-one)
→ owner: WorkspaceMember
→ taskTargets[], noteTargets[]
→ attachments[], timelineActivities[], favorites[]
```

### Note

```
id, title, position
bodyV2 (RichTextV2Metadata: blocknote JSON + markdown)
createdBy, updatedBy (ActorMetadata)

→ noteTargets[]   (links note to Companies/People/Opportunities)
→ attachments[], timelineActivities[], favorites[]
```

### Task

```
id, title, dueAt, status, position
status values: TODO, IN_PROGRESS, DONE
bodyV2 (RichTextV2Metadata)
createdBy, updatedBy (ActorMetadata)

→ assignee: WorkspaceMember
→ taskTargets[]   (links task to Companies/People/Opportunities)
→ attachments[], timelineActivities[], favorites[]
```

---

## 2. Composite (Structured) Field Types

Unlike Pipedrive's flat column approach, Twenty stores structured data as nested JSONB objects.

### ActorMetadata — who did what

```json
{
  "source": "IMPORT",            // MANUAL | API | IMPORT | EMAIL | CALENDAR | WORKFLOW | AGENT | WEBHOOK | APPLICATION | SYSTEM
  "workspaceMemberId": "uuid",   // null if system/import action
  "name": "Juuso Käyhkö",
  "context": {}
}
```

Use `source: "IMPORT"` for all migrated records. Set `name` to the original Pipedrive owner name.

### FullNameMetadata

```json
{ "firstName": "Matti", "lastName": "Virtanen" }
```

### EmailsMetadata

```json
{
  "primaryEmail": "matti@yritys.fi",
  "additionalEmails": ["matti.personal@gmail.com"]
}
```

### PhonesMetadata

```json
{
  "primaryPhoneNumber": "0401234567",
  "primaryPhoneCountryCode": "FI",
  "primaryPhoneCallingCode": "+358",
  "additionalPhones": []
}
```

### CurrencyMetadata

```json
{
  "amountMicros": 50000000000,   // €50,000 = 50,000 * 1,000,000
  "currencyCode": "EUR"
}
```

**Important:** Twenty stores money in **micros** (millionths). Multiply by 1,000,000.

### LinksMetadata

```json
{
  "primaryLinkLabel": "Website",
  "primaryLinkUrl": "https://example.com",
  "secondaryLinks": [
    { "label": "Blog", "url": "https://blog.example.com" }
  ]
}
```

### AddressMetadata

```json
{
  "addressStreet1": "Mannerheimintie 1",
  "addressStreet2": null,
  "addressCity": "Helsinki",
  "addressState": "Uusimaa",
  "addressZipCode": "00100",
  "addressCountry": "Finland",
  "addressLat": 60.169,
  "addressLng": 24.938
}
```

### RichTextV2Metadata (Note/Task body)

```json
{
  "blocknote": "{...block editor JSON...}",
  "markdown": "# Title\n\nBody text here"
}
```

For migration, populate `markdown` with plain text or converted markdown. Leave `blocknote` null.

---

## 3. Relationships & Junction Tables

### One-to-Many (direct foreign key)

| Parent      | Children            |
|-------------|---------------------|
| Company     | People              |
| Company     | Opportunities       |
| Person      | Opportunities (as pointOfContact) |
| WorkspaceMember | Tasks (assigned) |

### Many-to-Many via Junction Tables

#### NoteTarget

Links one Note to many records simultaneously:

```
NoteTarget:
  id (UUID)
  note → Note
  targetCompany → Company | null
  targetPerson → Person | null
  targetOpportunity → Opportunity | null
  targetCustom → CustomObject | null
```

A single note about a deal can be linked to a Company **and** a Person **and** an Opportunity.

#### TaskTarget

Same pattern as NoteTarget:

```
TaskTarget:
  id (UUID)
  task → Task
  targetCompany → Company | null
  targetPerson → Person | null
  targetOpportunity → Opportunity | null
  targetCustom → CustomObject | null
```

### Polymorphic (attachment/timeline to any object)

TimelineActivity, Attachment, and Favorite all use nullable foreign keys to each entity type, achieving polymorphism without a single polymorphic column.

---

## 4. Timeline & Activity History

This is the most important section for Pipedrive parity.

### TimelineActivity Entity

```
id, createdAt, updatedAt, deletedAt
happensAt: Date        — when the event occurred
name: string           — event label (e.g. "opportunity.created")
properties: JSONB      — arbitrary event data (changes, context)
linkedRecordId: UUID   — the "primary" record this event is about
linkedRecordCachedName: string  — cached display name (for performance)
linkedObjectMetadataId: UUID    — which object type the linked record is

→ workspaceMember     — who did it (null for system events)
→ targetCompany       — Company context | null
→ targetPerson        — Person context | null
→ targetOpportunity   — Opportunity context | null
→ targetNote          — Note context | null
→ targetTask          — Task context | null
```

### How Twenty generates timeline entries natively

Twenty auto-generates `TimelineActivity` records when:

1. **Notes** are created/updated/deleted on a record
2. **Tasks** are created/updated/deleted on a record
3. **Connected email** messages arrive for a person
4. **Calendar events** are synced for a person

It does **not** automatically generate timeline entries for:
- Field value changes on Company/Person/Opportunity
- Stage transitions on Opportunities
- Calls (no native call object)

### Pipedrive Timeline → Twenty Mapping

| Pipedrive Timeline Event           | Twenty Equivalent                                  |
|------------------------------------|----------------------------------------------------|
| Note added                         | Note record + NoteTarget + TimelineActivity        |
| Email sent/received                | Gmail/SMTP integration (native) OR Note (manual)  |
| Activity (call, meeting, task)     | Task record + TaskTarget + TimelineActivity        |
| Deal stage changed                 | **No native tracking** — needs custom TimelineActivity |
| Deal created                       | `createdBy` field + manual TimelineActivity        |
| Deal won/lost                      | **No native tracking** — needs custom TimelineActivity |
| File uploaded                      | Attachment record + TimelineActivity               |

---

## 5. Audit Trail Fields

Every entity stores `createdBy` and `updatedBy` as `ActorMetadata`. This tells you:
- **Who** created/updated a record (workspace member or system)
- **How** it was created (manually, via import, API, email, workflow, etc.)

This is weaker than Pipedrive's per-field change log. Twenty records the last actor, not a full history of every field change.

For migration, set:
```json
"createdBy": {
  "source": "IMPORT",
  "workspaceMemberId": null,
  "name": "Pipedrive Migration",
  "context": {}
}
```

---

## 6. Replicating Pipedrive's History Timeline

### What Pipedrive's timeline shows

Pipedrive's deal/contact timeline shows a chronological feed of:
- Notes
- Emails (in/out)
- Calls (log entries)
- Meetings
- Tasks (completed/upcoming)
- File uploads
- Stage changes
- Deal created/won/lost events
- Field edits (with old → new value)

### What Twenty shows natively

Twenty's timeline on a record shows:
- Notes linked to the record (via NoteTarget)
- Tasks linked to the record (via TaskTarget)
- Emails from connected Gmail/SMTP account (for People)
- Calendar events from connected Google Calendar (for People)

### Strategy: Populate TimelineActivity manually for history

To replicate historical Pipedrive activity, insert `TimelineActivity` rows directly. This is the correct approach — the `properties` JSONB column accepts arbitrary data.

#### Pattern for a "note added" event

```sql
INSERT INTO "timelineActivity" (
  id,
  "happensAt",
  name,
  properties,
  "linkedRecordId",
  "linkedRecordCachedName",
  "linkedObjectMetadataId",
  "workspaceMemberId",
  "targetOpportunityId",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  '2024-11-15T10:30:00Z',       -- original Pipedrive timestamp
  'note.created',
  '{"content": "Called client, discussed renewal"}',
  '<opportunity-uuid>',
  'Acme Corp Renewal',
  '<opportunity-object-metadata-id>',
  null,                          -- no matching workspace member
  '<opportunity-uuid>',
  NOW(),
  NOW()
);
```

#### Pattern for a "stage changed" event

```sql
INSERT INTO "timelineActivity" (
  id, "happensAt", name, properties,
  "linkedRecordId", "linkedRecordCachedName",
  "targetOpportunityId", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  '2024-11-20T14:00:00Z',
  'opportunity.stage.updated',
  '{"before": {"stage": "QUALIFIED"}, "after": {"stage": "WON"}}',
  '<opportunity-uuid>',
  'Acme Corp Renewal',
  '<opportunity-uuid>',
  NOW(), NOW()
);
```

#### Pattern for a "call logged" event (Pipedrive activity)

```sql
INSERT INTO "timelineActivity" (
  id, "happensAt", name, properties,
  "linkedRecordId", "linkedRecordCachedName",
  "targetPersonId", "targetOpportunityId", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  '2024-11-18T09:15:00Z',
  'call.logged',
  '{
    "subject": "Follow-up call",
    "duration": 1800,
    "outcome": "Left voicemail",
    "note": "Will call back Thursday"
  }',
  '<person-uuid>',
  'Matti Virtanen',
  '<person-uuid>',
  '<opportunity-uuid>',
  NOW(), NOW()
);
```

### Finding `linkedObjectMetadataId`

This ID is the UUID of the object type in Twenty's metadata registry. Query it:

```sql
-- In your Twenty database
SELECT id, "nameSingular", "namePlural"
FROM "objectMetadata"
WHERE "nameSingular" IN ('opportunity', 'person', 'company', 'note', 'task');
```

Store these IDs and use them when inserting TimelineActivity records.

---

## 7. Migration Mapping: Pipedrive → Twenty

### Pipedrive Deal → Twenty Opportunity

| Pipedrive Field      | Twenty Field                              | Notes                              |
|----------------------|-------------------------------------------|------------------------------------|
| `id`                 | (store in migration map)                  | Map to new UUID                    |
| `title`              | `name`                                    | Direct                             |
| `value`              | `amount.amountMicros`                     | Multiply by 1,000,000              |
| `currency`           | `amount.currencyCode`                     | ISO 4217                           |
| `status`             | `stage`                                   | Map: "won"→"WON", "lost"→"LOST"    |
| `stage_id`           | `stage`                                   | Map pipeline stage names           |
| `close_time`         | `closeDate`                               | ISO date only                      |
| `org_id`             | `companyId`                               | FK to migrated Company             |
| `person_id`          | `pointOfContactId`                        | FK to migrated Person              |
| `owner_id`           | `ownerId`                                 | FK to WorkspaceMember (if exists)  |
| `add_time`           | `createdAt`                               | Preserve original timestamp        |
| `update_time`        | `updatedAt`                               | Preserve original timestamp        |

### Pipedrive Organization → Twenty Company

| Pipedrive Field      | Twenty Field                              |
|----------------------|-------------------------------------------|
| `name`               | `name`                                    |
| `address`            | `address.addressStreet1` + parse          |
| `owner_id`           | `accountOwnerId`                          |
| `add_time`           | `createdAt`                               |
| `update_time`        | `updatedAt`                               |

### Pipedrive Person → Twenty Person

| Pipedrive Field      | Twenty Field                              |
|----------------------|-------------------------------------------|
| `name`               | `name.firstName` + `name.lastName`        |
| `email[0].value`     | `emails.primaryEmail`                     |
| `email[1...]`        | `emails.additionalEmails[]`               |
| `phone[0].value`     | `phones.primaryPhoneNumber`               |
| `phone[1...]`        | `phones.additionalPhones[]`               |
| `org_id`             | `companyId`                               |
| `job_title`          | `jobTitle`                                |

### Pipedrive Note → Twenty Note + NoteTarget

| Pipedrive Field      | Twenty/Target                             |
|----------------------|-------------------------------------------|
| `content`            | `note.bodyV2.markdown`                    |
| `add_time`           | `note.createdAt`                          |
| `deal_id`            | `noteTarget.targetOpportunityId`          |
| `person_id`          | `noteTarget.targetPersonId`               |
| `org_id`             | `noteTarget.targetCompanyId`              |

Note: Create one `NoteTarget` row per linked entity type, or create separate `NoteTarget` rows for each.

### Pipedrive Activity → Twenty Task + TaskTarget

| Pipedrive Field      | Twenty/Target                             |
|----------------------|-------------------------------------------|
| `subject`            | `task.title`                              |
| `note`               | `task.bodyV2.markdown`                    |
| `due_date`/`due_time`| `task.dueAt`                              |
| `done` (bool)        | `task.status` → "DONE" or "TODO"          |
| `deal_id`            | `taskTarget.targetOpportunityId`          |
| `person_id`          | `taskTarget.targetPersonId`               |
| `org_id`             | `taskTarget.targetCompanyId`              |
| `assigned_to_user_id`| `task.assigneeId`                         |

**Note on Activity Types:** Pipedrive activities have `type` (call, meeting, email, etc.). Twenty Tasks have no native type field. You can either:
1. Prefix the title: `[Call] Follow up with client`
2. Add a custom `SELECT` field to Task named "activityType"
3. Store all call activities as TimelineActivity events instead of Tasks

---

## 8. Custom Fields & Extensibility

Twenty supports custom fields on any object through its metadata system. You can add fields via the UI (Settings → Objects) or via API.

Available field types:
```
TEXT, NUMBER, BOOLEAN, DATE, DATE_TIME, SELECT, MULTI_SELECT,
CURRENCY, LINKS, EMAILS, PHONES, ADDRESS, FULL_NAME, RICH_TEXT_V2,
RATING, ARRAY, RAW_JSON
```

### Adding a custom field for Pipedrive Activity Type

If you want to preserve Pipedrive's activity type (call, meeting, email, task, deadline, lunch):

1. Go to **Settings → Objects → Task**
2. Add field: `activityType` (type: SELECT)
3. Options: `CALL`, `MEETING`, `EMAIL`, `TASK`, `DEADLINE`, `LUNCH`
4. Populate during migration

### Custom Opportunity stages

Twenty's default stages: `NEW`, `QUALIFIED`, `WON`, `LOST`

To add your Pipedrive pipeline stages:
1. Go to **Settings → Objects → Opportunity**
2. Edit the `stage` field
3. Add your stages

---

## 9. What Can and Cannot Be Replicated

### ✅ Fully Replicable

| Feature                        | How                                           |
|--------------------------------|-----------------------------------------------|
| Companies with all fields      | Direct mapping                                |
| People with emails/phones      | EmailsMetadata, PhonesMetadata                |
| Deals/Opportunities            | Direct mapping + CurrencyMetadata             |
| Notes with history timestamps  | Note + `createdAt` override                   |
| Tasks with due dates           | Task + TaskTarget                             |
| Note-to-deal links             | NoteTarget                                    |
| Task-to-deal links             | TaskTarget                                    |
| Created/Updated timestamps     | `createdAt`, `updatedAt` (can be set)         |
| Who created a record           | `createdBy.name` (stored as string)           |

### ⚠️ Partially Replicable

| Feature                        | Limitation                                              |
|--------------------------------|---------------------------------------------------------|
| Activity timeline              | Must insert TimelineActivity rows manually              |
| Stage change history           | Must create TimelineActivity for each historical change |
| Calls / meetings               | No native Call entity — use Task or TimelineActivity    |
| Email history                  | Only if you connect Gmail; historical emails = Notes    |
| User attribution               | `workspaceMemberId` only works if user exists in Twenty |
| Deal probability               | Field is deprecated in Twenty (can add custom field)    |

### ❌ Not Replicable (Without Custom Development)

| Feature                        | Reason                                                  |
|--------------------------------|---------------------------------------------------------|
| Per-field change log           | Twenty only tracks last `updatedBy`, not field history  |
| Call recordings / duration     | No native call recording entity                         |
| Email open tracking            | Only via connected email integration                    |
| Pipedrive Pipeline views       | Twenty has Kanban boards, configure stages to match     |
| Products on deals              | No native line-item/product entity (add custom object)  |
| Followers on records           | No native follower/subscriber feature                   |

---

## 10. Recommended Migration Strategy

### Phase 1: Core Records (already done)

1. Companies
2. People (with company links)
3. Opportunities (with company + person links)

### Phase 2: Notes and Tasks (with history)

For each Pipedrive note:
```python
# Insert note
note_id = insert_note(title="Note", body=note.content, createdAt=note.add_time)

# Link to all related records
if note.deal_id:
    insert_note_target(note_id, targetOpportunityId=deal_map[note.deal_id])
if note.person_id:
    insert_note_target(note_id, targetPersonId=person_map[note.person_id])
if note.org_id:
    insert_note_target(note_id, targetCompanyId=org_map[note.org_id])
```

For each Pipedrive activity:
```python
status = "DONE" if activity.done else "TODO"
task_id = insert_task(
    title=activity.subject,
    body=activity.note,
    dueAt=activity.due_date,
    status=status,
    createdAt=activity.add_time
)

if activity.deal_id:
    insert_task_target(task_id, targetOpportunityId=deal_map[activity.deal_id])
```

### Phase 3: Timeline History (Pipedrive activities as timeline events)

Insert `TimelineActivity` records for:
- Each activity (preserving original timestamps)
- Stage changes (if you exported the full changelog from Pipedrive)

```python
# For each Pipedrive activity
insert_timeline_activity(
    happensAt=activity.add_time,
    name=f"activity.{activity.type}",  # e.g. "activity.call"
    properties={
        "subject": activity.subject,
        "type": activity.type,
        "duration": activity.duration,
        "note": activity.note,
        "done": activity.done
    },
    linkedRecordId=deal_map.get(activity.deal_id) or person_map.get(activity.person_id),
    targetOpportunityId=deal_map.get(activity.deal_id),
    targetPersonId=person_map.get(activity.person_id),
    targetCompanyId=org_map.get(activity.org_id)
)
```

### Phase 4: Verify in UI

After migration:
1. Open a Company → check timeline shows notes and tasks
2. Open a Deal → check linked Person, Note, Task appear in timeline
3. Open a Person → check email/phone display correctly

### Database Schema Note

Twenty uses two PostgreSQL schemas:
- `public` — core platform tables (users, workspaces, metadata)
- `workspace_<id>` — per-workspace data (companies, people, opportunities, etc.)

All CRM data (companies, people, opportunities, notes, tasks, timelineActivities) lives in the workspace schema. Use `workspace_<id>."company"`, `workspace_<id>."person"`, etc.

Get your workspace schema:
```sql
SELECT id, "displayName", "subdomain" FROM "workspace" LIMIT 5;
-- Schema name: workspace_<id>
```

---

## Quick Reference: Table Names

In the workspace schema:

| Entity            | Table Name           |
|-------------------|----------------------|
| Company           | `company`            |
| Person            | `person`             |
| Opportunity       | `opportunity`        |
| Note              | `note`               |
| NoteTarget        | `noteTarget`         |
| Task              | `task`               |
| TaskTarget        | `taskTarget`         |
| TimelineActivity  | `timelineActivity`   |
| Attachment        | `attachment`         |
| WorkspaceMember   | `workspaceMember`    |
| Favorite          | `favorite`           |

All column names use **camelCase** (e.g., `closeDate`, `createdAt`, `targetOpportunityId`).

---

*Last updated: 2026-03-16. Based on Twenty main branch code at packages/twenty-server/src/modules/.*
