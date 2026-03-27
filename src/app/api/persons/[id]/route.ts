import { prisma } from "@/lib/prisma";
import { personSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const person = await prisma.person.findUnique({
      where: { id },
      include: { organization: true, deals: true, notes: true, activities: true, owner: true },
    });
    if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });
    return NextResponse.json(person);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = personSchema.partial().parse(body);

    // Clean empty strings for relation fields
    const cleanedData: Record<string, any> = { ...validatedData };
    if (cleanedData.organizationId === "") cleanedData.organizationId = undefined;
    if (cleanedData.ownerId === "") cleanedData.ownerId = undefined;
    if (cleanedData.email === "") cleanedData.email = undefined;

    const person = await prisma.person.update({
      where: { id },
      data: cleanedData,
      include: { organization: true, deals: true, notes: true, activities: true, owner: true },
    });
    return NextResponse.json(person);
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
    const person = await prisma.person.update({ where: { id }, data: { isDeleted: true } });
    return NextResponse.json(person);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
