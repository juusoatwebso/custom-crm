import { prisma } from "@/lib/prisma";
import { noteSchema } from "@/lib/validators";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const note = await prisma.note.findUnique({
      where: { id },
      include: { organization: true, person: true, deal: true, author: true },
    });
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    return NextResponse.json(note);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = noteSchema.partial().parse(body);
    const note = await prisma.note.update({
      where: { id },
      data: validatedData,
      include: { organization: true, person: true, deal: true, author: true },
    });
    return NextResponse.json(note);
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
    const note = await prisma.note.delete({ where: { id } });
    return NextResponse.json(note);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
