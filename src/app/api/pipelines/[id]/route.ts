import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const pipeline = await prisma.pipeline.findUnique({
      where: { id },
      include: {
        stages: {
          orderBy: { orderNr: "asc" },
          include: {
            deals: {
              where: { status: "OPEN", isLead: false, isDeleted: false },
              include: { organization: true, person: true, owner: true },
            },
          },
        },
      },
    });
    if (!pipeline) return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    return NextResponse.json(pipeline);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
