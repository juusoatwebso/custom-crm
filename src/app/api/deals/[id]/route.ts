import { prisma } from "@/lib/prisma";
import { dealSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const deal = await prisma.deal.findUnique({
      where: { id },
      include: { organization: true, person: true, stage: true, pipeline: true, notes: true, activities: true, owner: true },
    });
    if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    return NextResponse.json(deal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = dealSchema.partial().parse(body);

    // Clean empty strings for relation fields
    const relationFields = ["pipelineId", "stageId", "organizationId", "personId", "ownerId"];
    const cleanedData: Record<string, any> = { ...validatedData };
    for (const field of relationFields) {
      if (cleanedData[field] === "") {
        cleanedData[field] = undefined;
      }
    }

    // Update stageChangedAt when stage changes
    if (cleanedData.stageId) {
      const currentDeal = await prisma.deal.findUnique({ where: { id }, select: { stageId: true } });
      if (currentDeal && currentDeal.stageId !== cleanedData.stageId) {
        cleanedData.stageChangedAt = new Date();
      }
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: cleanedData,
      include: { organization: true, person: true, stage: true, pipeline: true, notes: true, activities: true, owner: true },
    });
    return NextResponse.json(deal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const deal = await prisma.deal.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json(deal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
