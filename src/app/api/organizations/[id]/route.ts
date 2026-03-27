import { prisma } from "@/lib/prisma";
import { organizationSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        persons: true,
        deals: { include: { stage: true } },
        notes: { orderBy: { createdAt: "desc" } },
        activities: true,
        owner: true,
      },
    });

    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }
    return NextResponse.json(organization);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = organizationSchema.partial().parse(body);

    // Clean empty strings for relation fields
    const cleanedData: Record<string, any> = { ...validatedData };
    if (cleanedData.ownerId === "") cleanedData.ownerId = undefined;

    const organization = await prisma.organization.update({
      where: { id },
      data: cleanedData,
      include: {
        persons: true,
        deals: { include: { stage: true } },
        notes: { orderBy: { createdAt: "desc" } },
        activities: true,
        owner: true,
      },
    });
    return NextResponse.json(organization);
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
    const organization = await prisma.organization.update({
      where: { id },
      data: { isDeleted: true },
    });
    return NextResponse.json(organization);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
