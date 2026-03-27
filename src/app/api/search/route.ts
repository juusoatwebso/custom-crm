import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q") || "";

    if (!q || q.length < 2) {
      return NextResponse.json({
        organizations: [],
        persons: [],
        deals: [],
      });
    }

    const [organizations, persons, deals] = await Promise.all([
      prisma.organization.findMany({
        where: {
          name: {
            contains: q,
            mode: "insensitive",
          },
          isDeleted: false,
        },
        take: 5,
      }),
      prisma.person.findMany({
        where: {
          OR: [
            {
              firstName: {
                contains: q,
                mode: "insensitive",
              },
            },
            {
              lastName: {
                contains: q,
                mode: "insensitive",
              },
            },
          ],
          isDeleted: false,
        },
        take: 5,
      }),
      prisma.deal.findMany({
        where: {
          title: {
            contains: q,
            mode: "insensitive",
          },
          isDeleted: false,
        },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      organizations,
      persons,
      deals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
