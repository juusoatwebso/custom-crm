import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";


const prisma = new PrismaClient();

const DATA_DIR = path.join(__dirname, "../crm-migration/data/raw");

function readJsonFile<T>(filename: string): T[] {
  const filepath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`File not found: ${filepath}`);
    return [];
  }
  const content = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(content);
}

interface HasAddTime {
  id: number | string;
  add_time: string;
  update_time?: string;
}

async function fixOrganizationDates() {
  console.log("\n=== Fixing Organization dates ===");
  const orgs = readJsonFile<HasAddTime & { id: number }>("organizations.json");
  let updated = 0;

  for (const org of orgs) {
    if (!org.add_time) continue;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Organization" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(org.add_time),
        org.id
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} organization dates`);
}

async function fixPersonDates() {
  console.log("\n=== Fixing Person dates ===");
  const persons = readJsonFile<HasAddTime & { id: number }>("persons.json");
  let updated = 0;

  for (const person of persons) {
    if (!person.add_time) continue;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Person" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(person.add_time),
        person.id
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} person dates`);
}

async function fixDealDates() {
  console.log("\n=== Fixing Deal dates ===");
  const deals = readJsonFile<HasAddTime>("deals.json");
  let updated = 0;

  for (const deal of deals) {
    if (!deal.add_time) continue;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Deal" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(deal.add_time),
        String(deal.id)
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} deal dates`);
}

async function fixLeadDates() {
  console.log("\n=== Fixing Lead dates ===");
  const leads = readJsonFile<HasAddTime>("leads.json");
  let updated = 0;

  for (const lead of leads) {
    if (!lead.add_time) continue;
    const pipedriveId = `lead_${lead.id}`;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Deal" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(lead.add_time),
        pipedriveId
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} lead dates`);
}

async function fixActivityDates() {
  console.log("\n=== Fixing Activity dates ===");
  const activities = readJsonFile<HasAddTime & { id: number }>("activities.json");
  let updated = 0;

  for (const activity of activities) {
    if (!activity.add_time) continue;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Activity" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(activity.add_time),
        activity.id
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} activity dates`);
}

async function fixNoteDates() {
  console.log("\n=== Fixing Note dates ===");
  const notes = readJsonFile<HasAddTime & { id: number }>("notes.json");
  let updated = 0;

  for (const note of notes) {
    if (!note.add_time) continue;
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "Note" SET "createdAt" = $1 WHERE "pipedriveId" = $2`,
        new Date(note.add_time),
        note.id
      );
      if (result > 0) updated++;
    } catch (error) {
      // Record may not exist, skip
    }
  }
  console.log(`✓ Updated ${updated} note dates`);
}

async function main() {
  console.log("Fixing dates from Pipedrive add_time...");
  console.log(`Data directory: ${DATA_DIR}`);

  try {
    await fixOrganizationDates();
    await fixPersonDates();
    await fixDealDates();
    await fixLeadDates();
    await fixActivityDates();
    await fixNoteDates();
    console.log("\n✓ Date fix completed!");
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
