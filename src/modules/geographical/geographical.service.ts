import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class GeographicalService {
  /**
   * 🔥 GET ALL REGIONS
   * Returns all Philippine regions
   */
  static async getAllRegions() {
    return await prisma.region.findMany({
      where: { isActive: true },
      orderBy: { regName: "asc" },
    });
  }

  /**
   * 🔥 GET SINGLE REGION BY CODE
   */
  static async getRegionByCode(regCode: string) {
    return await prisma.region.findUnique({
      where: { regCode },
      include: {
        provinces: {
          where: { isActive: true },
          orderBy: { provName: "asc" },
        },
      },
    });
  }

  /**
   * 🔥 GET ALL PROVINCES BY REGION
   * @param regCode Region code (e.g., "13" for NCR)
   */
  static async getProvincesByRegion(regCode: string) {
    return await prisma.province.findMany({
      where: {
        regCode,
        isActive: true,
      },
      orderBy: { provName: "asc" },
    });
  }

  /**
   * 🔥 GET SINGLE PROVINCE BY CODE
   */
  static async getProvinceByCode(provCode: string) {
    return await prisma.province.findUnique({
      where: { provCode },
      include: {
        region: true,
        cities: {
          where: { isActive: true },
          orderBy: { cityName: "asc" },
        },
      },
    });
  }

  /**
   * 🔥 GET ALL CITIES BY PROVINCE
   * @param provCode Province code (e.g., "13000" for Metro Manila)
   */
  static async getCitiesByProvince(provCode: string) {
    return await prisma.city.findMany({
      where: {
        provCode,
        isActive: true,
      },
      orderBy: { cityName: "asc" },
    });
  }

  /**
   * 🔥 GET SINGLE CITY BY CODE
   */
  static async getCityByCode(cityCode: string) {
    return await prisma.city.findUnique({
      where: { cityCode },
      include: {
        province: {
          include: { region: true },
        },
        barangays: {
          where: { isActive: true },
          orderBy: { brgyName: "asc" },
        },
      },
    });
  }

  /**
   * 🔥 GET ALL BARANGAYS BY CITY
   * @param cityCode City code (e.g., "1380100" for Caloocan)
   */
  static async getBarangaysByCity(cityCode: string) {
    return await prisma.barangay.findMany({
      where: {
        cityCode,
        isActive: true,
      },
      orderBy: { brgyName: "asc" },
    });
  }

  /**
   * 🔥 GET SINGLE BARANGAY BY CODE
   */
  static async getBarangayByCode(brgyCode: string) {
    return await prisma.barangay.findUnique({
      where: { brgyCode },
      include: {
        city: {
          include: {
            province: {
              include: { region: true },
            },
          },
        },
      },
    });
  }

  /**
   * 🔥 SEARCH FUNCTIONALITY
   * Search regions, provinces, cities, or barangays by name
   */
  static async search(query: string, type?: "region" | "province" | "city" | "barangay") {
    const searchQuery = `%${query}%`;

    const results: any = {};

    if (!type || type === "region") {
      results.regions = await prisma.region.findMany({
        where: {
          regName: { contains: query, mode: "insensitive" },
          isActive: true,
        },
        take: 10,
      });
    }

    if (!type || type === "province") {
      results.provinces = await prisma.province.findMany({
        where: {
          provName: { contains: query, mode: "insensitive" },
          isActive: true,
        },
        include: { region: true },
        take: 10,
      });
    }

    if (!type || type === "city") {
      results.cities = await prisma.city.findMany({
        where: {
          cityName: { contains: query, mode: "insensitive" },
          isActive: true,
        },
        include: { province: true },
        take: 10,
      });
    }

    if (!type || type === "barangay") {
      results.barangays = await prisma.barangay.findMany({
        where: {
          brgyName: { contains: query, mode: "insensitive" },
          isActive: true,
        },
        include: { city: true },
        take: 10,
      });
    }

    return results;
  }

  /**
   * 🔥 GET COMPLETE HIERARCHY
   * Get region with all nested provinces, cities, and barangays
   */
  static async getCompleteHierarchy(regCode: string) {
    return await prisma.region.findUnique({
      where: { regCode },
      include: {
        provinces: {
          where: { isActive: true },
          include: {
            cities: {
              where: { isActive: true },
              include: {
                barangays: {
                  where: { isActive: true },
                  orderBy: { brgyName: "asc" },
                },
              },
              orderBy: { cityName: "asc" },
            },
          },
          orderBy: { provName: "asc" },
        },
      },
    });
  }
}
