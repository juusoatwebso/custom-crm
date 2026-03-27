import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// Data directory path
const DATA_DIR = path.join(
  __dirname,
  "../crm-migration/data/raw"
);

// Type definitions
interface PipedriveUser {
  id: number;
  name: string;
  email: string;
  is_deleted: boolean;
}

interface PipedrivePipeline {
  id: number;
  name: string;
  order_nr: number;
}

interface PipedriveStage {
  id: number;
  name: string;
  pipeline_id: number;
  order_nr: number;
  deal_probability: number;
}

interface PipedriveOrganization {
  id: number;
  name: string;
  address: {
    value?: string;
    route?: string;
    street_number?: string;
    locality?: string;
    country?: string;
  } | null;
  owner_id: number | null;
  website?: string;
  is_deleted: boolean;
  add_time: string;
  update_time: string;
  custom_fields: Record<string, string>;
}

interface PipedrivePerson {
  id: number;
  first_name: string;
  last_name: string | null;
  emails: Array<{ value: string }>;
  phones: Array<{ value: string }>;
  org_id: number | null;
  owner_id: number | null;
  is_deleted: boolean;
  add_time: string;
  update_time: string;
  custom_fields: Record<string, string>;
}

interface PipedriveDeal {
  id: number | string;
  title: string;
  status: "open" | "won" | "lost";
  value: number | null;
  currency: string;
  expected_close_date: string | null;
  lost_reason: string | null;
  probability: number | null;
  stage_id: number | null;
  pipeline_id: number | null;
  org_id: number | null;
  person_id: number | null;
  user_id: number | null;
  creator_user_id: number | null;
  origin: string | null;
  stage_change_time: string | null;
  won_time: string | null;
  lost_time: string | null;
  close_time: string | null;
  is_deleted: boolean;
  add_time: string;
  update_time: string;
  custom_fields: Record<string, string>;
}

interface PipedriveLead {
  id: number | string;
  title: string;
  value: {
    amount: number | null;
    currency: string;
  };
  expected_close_date: string | null;
  organization_id: number | null;
  person_id: number | null;
  owner_id: number | null;
  origin: string | null;
  source_name: string | null;
  is_archived: boolean;
  add_time: string;
  update_time: string;
}

interface PipedriveActivity {
  id: number;
  subject: string;
  type: string;
  done: boolean;
  note: string | null;
  due_date: string | null;
  due_time: string | null;
  duration: string | null;
  location: string | null;
  owner_id: number | null;
  creator_user_id: number | null;
  org_id: number | null;
  person_id: number | null;
  deal_id: number | null;
  is_deleted: boolean;
  add_time: string;
  update_time: string;
  custom_fields: Record<string, string>;
}

interface PipedriveNote {
  id: number;
  content: string;
  user_id: number | null;
  org_id: number | null;
  person_id: number | null;
  deal_id: number | null;
  add_time: string;
  update_time: string;
}

// Custom field hash keys for organizations
const ORG_CUSTOM_FIELDS = {
  ytunnus: "931425dd4a675487146add0d454d2927ce41f2fc",
  virallinen_nimi: "a233077bb653400c6a6fcfebb3851cd4dd039915",
  henkilokunta: "8e248eb04d03c62894bc34a39a7a395ae5a007fa",
  liikevaihto: "312b2fa7cef1b39558d40e2b64e659ccf8993680",
  perustettu: "af0ff61c2117c518fd67862bca60dc006cf24eb5",
  paatoimiala_tol: "54fb878d1bed7f4ece48ca37be3d9102672e0c4e",
  paatoimiala_pf: "d0ddd72ec2c009bd6d74ff88f3fbb1831bcf6125",
  markkinointinimi: "19396b4979bfbc4d1dff20bd4e18934709d069ea",
  www: "8c93d48db9e4713a692d2193a3041ceeaeb79aee",
};

// Custom field hash keys for persons
const PERSON_CUSTOM_FIELDS = {
  title_en: "4c9293737b1fa9399cb4eeb5c36c5391bc10bddd",
  title_fi: "e629f88dd960275ca6aadfe10ff8608578433f5c",
};

// Custom field hash key for deals
const DEAL_CUSTOM_FIELDS = {
  drive: "27d4af5421c600368b825b433bae74c2691e19a9",
};

// Helper function to strip HTML
function htmlToText(html: string | null): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Helper function to normalize address
function normalizeAddress(
  addressObj: {
    value?: string;
    route?: string;
    street_number?: string;
    locality?: string;
    country?: string;
  } | null
): string | null {
  if (!addressObj) return null;
  if (!addressObj.value && !addressObj.route && !addressObj.locality && !addressObj.country) {
    return null;
  }

  const parts: string[] = [];
  if (addressObj.route) {
    const street = addressObj.street_number
      ? `${addressObj.route} ${addressObj.street_number}`
      : addressObj.route;
    parts.push(street);
  }
  if (addressObj.locality) parts.push(addressObj.locality);
  if (addressObj.country) parts.push(addressObj.country);

  if (parts.length > 0) return parts.join(", ");
  return addressObj.value || null;
}

// Helper function to read JSON file
function readJsonFile<T>(filename: string): T[] {
  const filepath = path.join(DATA_DIR, filename);
  const content = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(content);
}

// Helper function to map activity types
function mapActivityType(
  type: string
): "CALL" | "MEETING" | "EMAIL" | "UNANSWERED_CALL" | "TASK" | "DEADLINE" | "LUNCH" | "BUUKKAUS" | "PERUTTU_PALAVERI" {
  const typeMap: Record<string, any> = {
    call: "CALL",
    meeting: "MEETING",
    email: "EMAIL",
    unanswered_call: "UNANSWERED_CALL",
    task: "TASK",
    deadline: "DEADLINE",
    lunch: "LUNCH",
    buukkaus: "BUUKKAUS",
    peruttu_palaveri: "PERUTTU_PALAVERI",
  };
  return typeMap[type.toLowerCase()] || "TASK";
}

// Import phases
async function importUsers(): Promise<Map<number, string>> {
  console.log("\n=== Importing Users ===");
  const users = readJsonFile<PipedriveUser>("users.json");
  const userMap = new Map<number, string>();

  for (const user of users) {
    try {
      const createdUser = await prisma.user.upsert({
        where: { email: user.email },
        update: { pipedriveId: user.id },
        create: {
          email: user.email,
          name: user.name,
          pipedriveId: user.id,
        },
      });
      userMap.set(user.id, createdUser.id);
    } catch (error) {
      console.error(`Error importing user ${user.id}:`, error);
    }
  }

  console.log(`✓ Imported ${userMap.size} users`);
  return userMap;
}

async function importPipelines(): Promise<Map<number, string>> {
  console.log("\n=== Importing Pipelines ===");
  const pipelines = readJsonFile<PipedrivePipeline>("pipelines.json");
  const pipelineMap = new Map<number, string>();

  for (const pipeline of pipelines) {
    try {
      const createdPipeline = await prisma.pipeline.upsert({
        where: { pipedriveId: pipeline.id },
        update: { name: pipeline.name },
        create: {
          name: pipeline.name,
          pipedriveId: pipeline.id,
          orderNr: pipeline.order_nr || 0,
        },
      });
      pipelineMap.set(pipeline.id, createdPipeline.id);
    } catch (error) {
      console.error(`Error importing pipeline ${pipeline.id}:`, error);
    }
  }

  console.log(`✓ Imported ${pipelineMap.size} pipelines`);
  return pipelineMap;
}

async function importStages(
  pipelineMap: Map<number, string>
): Promise<Map<number, string>> {
  console.log("\n=== Importing Stages ===");
  const stages = readJsonFile<PipedriveStage>("stages.json");
  const stageMap = new Map<number, string>();

  for (const stage of stages) {
    try {
      const pipelineDbId = pipelineMap.get(stage.pipeline_id);
      if (!pipelineDbId) {
        console.warn(`Stage ${stage.id}: Pipeline ${stage.pipeline_id} not found`);
        continue;
      }

      const createdStage = await prisma.stage.upsert({
        where: { pipedriveId: stage.id },
        update: { name: stage.name },
        create: {
          name: stage.name,
          pipedriveId: stage.id,
          pipelineId: pipelineDbId,
          orderNr: stage.order_nr || 0,
          dealProbability: stage.deal_probability || 100,
        },
      });
      stageMap.set(stage.id, createdStage.id);
    } catch (error) {
      console.error(`Error importing stage ${stage.id}:`, error);
    }
  }

  console.log(`✓ Imported ${stageMap.size} stages`);
  return stageMap;
}

async function importOrganizations(
  userMap: Map<number, string>
): Promise<Map<number, string>> {
  console.log("\n=== Importing Organizations ===");
  const organizations = readJsonFile<PipedriveOrganization>("organizations.json");
  const organizationMap = new Map<number, string>();

  for (const org of organizations) {
    try {
      const ownerDbId = org.owner_id ? userMap.get(org.owner_id) : undefined;
      const address = normalizeAddress(org.address);
      const website =
        org.custom_fields?.[ORG_CUSTOM_FIELDS.www] || org.website || undefined;

      const createdOrg = await prisma.organization.upsert({
        where: { pipedriveId: org.id },
        update: {
          name: org.name,
          address,
          website,
          ytunnus: org.custom_fields?.[ORG_CUSTOM_FIELDS.ytunnus],
          virallinen_nimi: org.custom_fields?.[ORG_CUSTOM_FIELDS.virallinen_nimi],
          henkilokunta: org.custom_fields?.[ORG_CUSTOM_FIELDS.henkilokunta],
          liikevaihto: org.custom_fields?.[ORG_CUSTOM_FIELDS.liikevaihto],
          perustettu: org.custom_fields?.[ORG_CUSTOM_FIELDS.perustettu],
          paatoimiala_tol: org.custom_fields?.[ORG_CUSTOM_FIELDS.paatoimiala_tol],
          paatoimiala_pf: org.custom_fields?.[ORG_CUSTOM_FIELDS.paatoimiala_pf],
          markkinointinimi: org.custom_fields?.[ORG_CUSTOM_FIELDS.markkinointinimi],
          isDeleted: org.is_deleted,
          ownerId: ownerDbId,
        },
        create: {
          name: org.name,
          address,
          website,
          ytunnus: org.custom_fields?.[ORG_CUSTOM_FIELDS.ytunnus],
          virallinen_nimi: org.custom_fields?.[ORG_CUSTOM_FIELDS.virallinen_nimi],
          henkilokunta: org.custom_fields?.[ORG_CUSTOM_FIELDS.henkilokunta],
          liikevaihto: org.custom_fields?.[ORG_CUSTOM_FIELDS.liikevaihto],
          perustettu: org.custom_fields?.[ORG_CUSTOM_FIELDS.perustettu],
          paatoimiala_tol: org.custom_fields?.[ORG_CUSTOM_FIELDS.paatoimiala_tol],
          paatoimiala_pf: org.custom_fields?.[ORG_CUSTOM_FIELDS.paatoimiala_pf],
          markkinointinimi: org.custom_fields?.[ORG_CUSTOM_FIELDS.markkinointinimi],
          pipedriveId: org.id,
          isDeleted: org.is_deleted,
          ownerId: ownerDbId,
          createdAt: org.add_time ? new Date(org.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (org.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Organization" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(org.add_time),
          org.id
        );
      }
      organizationMap.set(org.id, createdOrg.id);
    } catch (error) {
      console.error(`Error importing organization ${org.id}:`, error);
    }
  }

  console.log(`✓ Imported ${organizationMap.size} organizations`);
  return organizationMap;
}

async function importPersons(
  userMap: Map<number, string>,
  organizationMap: Map<number, string>
): Promise<Map<number, string>> {
  console.log("\n=== Importing Persons ===");
  const persons = readJsonFile<PipedrivePerson>("persons.json");
  const personMap = new Map<number, string>();

  for (const person of persons) {
    try {
      const ownerDbId = person.owner_id ? userMap.get(person.owner_id) : undefined;
      const organizationDbId = person.org_id
        ? organizationMap.get(person.org_id)
        : undefined;
      const email = person.emails?.[0]?.value;
      const phone = person.phones?.[0]?.value;
      const jobTitle =
        person.custom_fields?.[PERSON_CUSTOM_FIELDS.title_en] ||
        person.custom_fields?.[PERSON_CUSTOM_FIELDS.title_fi];

      const createdPerson = await prisma.person.upsert({
        where: { pipedriveId: person.id },
        update: {
          firstName: person.first_name,
          lastName: person.last_name,
          email,
          phone,
          jobTitle,
          organizationId: organizationDbId,
          ownerId: ownerDbId,
          isDeleted: person.is_deleted,
        },
        create: {
          firstName: person.first_name,
          lastName: person.last_name,
          email,
          phone,
          jobTitle,
          pipedriveId: person.id,
          organizationId: organizationDbId,
          ownerId: ownerDbId,
          isDeleted: person.is_deleted,
          createdAt: person.add_time ? new Date(person.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (person.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Person" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(person.add_time),
          person.id
        );
      }

      personMap.set(person.id, createdPerson.id);
    } catch (error) {
      console.error(`Error importing person ${person.id}:`, error);
    }
  }

  console.log(`✓ Imported ${personMap.size} persons`);
  return personMap;
}

async function importDeals(
  userMap: Map<number, string>,
  pipelineMap: Map<number, string>,
  stageMap: Map<number, string>,
  organizationMap: Map<number, string>,
  personMap: Map<number, string>
): Promise<Map<string, string>> {
  console.log("\n=== Importing Deals ===");
  const deals = readJsonFile<PipedriveDeal>("deals.json");
  const dealMap = new Map<string, string>();

  for (const deal of deals) {
    try {
      const pipelineDbId = deal.pipeline_id
        ? pipelineMap.get(deal.pipeline_id)
        : undefined;
      const stageDbId = deal.stage_id ? stageMap.get(deal.stage_id) : undefined;
      const organizationDbId = deal.org_id
        ? organizationMap.get(deal.org_id)
        : undefined;
      const personDbId = deal.person_id ? personMap.get(deal.person_id) : undefined;

      const ownerDbId = deal.user_id
        ? userMap.get(deal.user_id)
        : deal.creator_user_id
          ? userMap.get(deal.creator_user_id)
          : undefined;

      const statusMap: Record<string, any> = {
        open: "OPEN",
        won: "WON",
        lost: "LOST",
      };

      const drive = deal.custom_fields?.[DEAL_CUSTOM_FIELDS.drive];
      const origin = deal.origin === "ManuallyCreated" ? "Pipedrive" : deal.origin;

      const createdDeal = await prisma.deal.upsert({
        where: { pipedriveId: String(deal.id) },
        update: {
          title: deal.title,
          status: statusMap[deal.status] || "OPEN",
          value: deal.value || undefined,
          currency: deal.currency || "EUR",
          expectedCloseDate: deal.expected_close_date,
          lostReason: deal.lost_reason,
          probability: deal.probability || undefined,
          stageChangedAt: deal.stage_change_time
            ? new Date(deal.stage_change_time)
            : undefined,
          wonAt: deal.won_time ? new Date(deal.won_time) : undefined,
          lostAt: deal.lost_time ? new Date(deal.lost_time) : undefined,
          origin,
          drive,
          pipelineId: pipelineDbId,
          stageId: stageDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          ownerId: ownerDbId,
          isDeleted: deal.is_deleted,
        },
        create: {
          title: deal.title,
          status: statusMap[deal.status] || "OPEN",
          pipedriveId: String(deal.id),
          value: deal.value || undefined,
          currency: deal.currency || "EUR",
          expectedCloseDate: deal.expected_close_date,
          lostReason: deal.lost_reason,
          probability: deal.probability || undefined,
          stageChangedAt: deal.stage_change_time
            ? new Date(deal.stage_change_time)
            : undefined,
          wonAt: deal.won_time ? new Date(deal.won_time) : undefined,
          lostAt: deal.lost_time ? new Date(deal.lost_time) : undefined,
          origin,
          drive,
          pipelineId: pipelineDbId,
          stageId: stageDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          ownerId: ownerDbId,
          isDeleted: deal.is_deleted,
          createdAt: deal.add_time ? new Date(deal.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (deal.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Deal" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(deal.add_time),
          String(deal.id)
        );
      }

      dealMap.set(String(deal.id), createdDeal.id);
    } catch (error) {
      console.error(`Error importing deal ${deal.id}:`, error);
    }
  }

  console.log(`✓ Imported ${dealMap.size} deals`);
  return dealMap;
}

async function importLeads(
  userMap: Map<number, string>,
  organizationMap: Map<number, string>,
  personMap: Map<number, string>
): Promise<Map<string, string>> {
  console.log("\n=== Importing Leads ===");
  const leads = readJsonFile<PipedriveLead>("leads.json");
  const leadMap = new Map<string, string>();

  for (const lead of leads) {
    try {
      const organizationDbId = lead.organization_id
        ? organizationMap.get(lead.organization_id)
        : undefined;
      const personDbId = lead.person_id
        ? personMap.get(lead.person_id)
        : undefined;
      const ownerDbId = lead.owner_id ? userMap.get(lead.owner_id) : undefined;
      const origin = lead.source_name || lead.origin;
      const pipedriveId = `lead_${lead.id}`;

      const createdLead = await prisma.deal.upsert({
        where: { pipedriveId: pipedriveId },
        update: {
          title: lead.title,
          value: lead.value?.amount || undefined,
          currency: lead.value?.currency || "EUR",
          expectedCloseDate: lead.expected_close_date,
          origin,
          organizationId: organizationDbId,
          personId: personDbId,
          ownerId: ownerDbId,
          isDeleted: lead.is_archived,
        },
        create: {
          title: lead.title,
          status: "OPEN",
          isLead: true,
          pipelineName: "Leads",
          pipelineStage: "Lead",
          pipedriveId,
          value: lead.value?.amount || undefined,
          currency: lead.value?.currency || "EUR",
          expectedCloseDate: lead.expected_close_date,
          origin,
          organizationId: organizationDbId,
          personId: personDbId,
          ownerId: ownerDbId,
          isDeleted: lead.is_archived,
          createdAt: lead.add_time ? new Date(lead.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (lead.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Deal" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(lead.add_time),
          pipedriveId
        );
      }

      leadMap.set(String(lead.id), createdLead.id);
    } catch (error) {
      console.error(`Error importing lead ${lead.id}:`, error);
    }
  }

  console.log(`✓ Imported ${leadMap.size} leads`);
  return leadMap;
}

async function importActivities(
  userMap: Map<number, string>,
  organizationMap: Map<number, string>,
  personMap: Map<number, string>,
  dealMap: Map<string, string>
): Promise<number> {
  console.log("\n=== Importing Activities ===");
  const activities = readJsonFile<PipedriveActivity>("activities.json");
  let imported = 0;

  for (const activity of activities) {
    try {
      const assigneeDbId = activity.owner_id
        ? userMap.get(activity.owner_id)
        : undefined;
      const creatorDbId = activity.creator_user_id
        ? userMap.get(activity.creator_user_id)
        : undefined;
      const organizationDbId = activity.org_id
        ? organizationMap.get(activity.org_id)
        : undefined;
      const personDbId = activity.person_id
        ? personMap.get(activity.person_id)
        : undefined;
      const dealDbId = activity.deal_id
        ? dealMap.get(String(activity.deal_id))
        : undefined;

      await prisma.activity.upsert({
        where: { pipedriveId: activity.id },
        update: {
          subject: activity.subject,
          type: mapActivityType(activity.type),
          done: activity.done,
          note: activity.note ? htmlToText(activity.note) : undefined,
          dueDate: activity.due_date ? new Date(activity.due_date) : undefined,
          dueTime: activity.due_time,
          duration: activity.duration,
          location: typeof activity.location === 'object' && activity.location !== null ? (activity.location as any).value || (activity.location as any).formatted_address || '' : activity.location || undefined,
          assigneeId: assigneeDbId,
          creatorId: creatorDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          dealId: dealDbId,
          isDeleted: activity.is_deleted,
        },
        create: {
          subject: activity.subject,
          type: mapActivityType(activity.type),
          done: activity.done,
          note: activity.note ? htmlToText(activity.note) : undefined,
          dueDate: activity.due_date ? new Date(activity.due_date) : undefined,
          dueTime: activity.due_time,
          duration: activity.duration,
          location: typeof activity.location === 'object' && activity.location !== null ? (activity.location as any).value || (activity.location as any).formatted_address || '' : activity.location || undefined,
          pipedriveId: activity.id,
          assigneeId: assigneeDbId,
          creatorId: creatorDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          dealId: dealDbId,
          isDeleted: activity.is_deleted,
          createdAt: activity.add_time ? new Date(activity.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (activity.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Activity" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(activity.add_time),
          activity.id
        );
      }

      imported++;
    } catch (error) {
      console.error(`Error importing activity ${activity.id}`);
    }
  }

  console.log(`✓ Imported ${imported} activities`);
  return imported;
}

async function importNotes(
  userMap: Map<number, string>,
  organizationMap: Map<number, string>,
  personMap: Map<number, string>,
  dealMap: Map<string, string>
): Promise<number> {
  console.log("\n=== Importing Notes ===");
  const notes = readJsonFile<PipedriveNote>("notes.json");
  let imported = 0;

  for (const note of notes) {
    try {
      const authorDbId = note.user_id ? userMap.get(note.user_id) : undefined;
      const organizationDbId = note.org_id
        ? organizationMap.get(note.org_id)
        : undefined;
      const personDbId = note.person_id ? personMap.get(note.person_id) : undefined;
      const dealDbId = note.deal_id ? dealMap.get(String(note.deal_id)) : undefined;

      await prisma.note.upsert({
        where: { pipedriveId: note.id },
        update: {
          content: htmlToText(note.content),
          authorId: authorDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          dealId: dealDbId,
        },
        create: {
          content: htmlToText(note.content),
          pipedriveId: note.id,
          authorId: authorDbId,
          organizationId: organizationDbId,
          personId: personDbId,
          dealId: dealDbId,
          createdAt: note.add_time ? new Date(note.add_time) : undefined,
        },
      });

      // Update createdAt via raw SQL to preserve original Pipedrive date
      if (note.add_time) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Note" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
          new Date(note.add_time),
          note.id
        );
      }

      imported++;
    } catch (error) {
      console.error(`Error importing note ${note.id}:`, error);
    }
  }

  console.log(`✓ Imported ${imported} notes`);
  return imported;
}

// Main import function
async function main() {
  console.log("Starting Pipedrive data import...");
  console.log(`Data directory: ${DATA_DIR}`);

  try {
    // Phase 1: Import Users
    const userMap = await importUsers();

    // Phase 2: Import Pipelines
    const pipelineMap = await importPipelines();

    // Phase 3: Import Stages
    const stageMap = await importStages(pipelineMap);

    // Phase 4: Import Organizations
    const organizationMap = await importOrganizations(userMap);

    // Phase 5: Import Persons
    const personMap = await importPersons(userMap, organizationMap);

    // Phase 6: Import Deals
    const dealMap = await importDeals(
      userMap,
      pipelineMap,
      stageMap,
      organizationMap,
      personMap
    );

    // Phase 7: Import Leads
    const leadMap = await importLeads(userMap, organizationMap, personMap);

    // Phase 8: Import Activities
    const activitiesCount = await importActivities(
      userMap,
      organizationMap,
      personMap,
      dealMap
    );

    // Phase 9: Import Notes
    const notesCount = await importNotes(
      userMap,
      organizationMap,
      personMap,
      dealMap
    );

    // Get final counts
    console.log("\n=== Import Summary ===");
    const userCount = await prisma.user.count();
    const pipelineCount = await prisma.pipeline.count();
    const stageCount = await prisma.stage.count();
    const organizationCount = await prisma.organization.count();
    const personCount = await prisma.person.count();
    const dealCount = await prisma.deal.count();
    const activityCount = await prisma.activity.count();
    const noteCount = await prisma.note.count();

    console.log(`Users: ${userCount}`);
    console.log(`Pipelines: ${pipelineCount}`);
    console.log(`Stages: ${stageCount}`);
    console.log(`Organizations: ${organizationCount}`);
    console.log(`Persons: ${personCount}`);
    console.log(`Deals: ${dealCount}`);
    console.log(`Activities: ${activityCount}`);
    console.log(`Notes: ${noteCount}`);

    console.log("\n✓ Import completed successfully!");
  } catch (error) {
    console.error("Fatal error during import:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
