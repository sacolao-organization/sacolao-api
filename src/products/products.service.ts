import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  private cache = new Map<string, { data: any; exp: number }>();

  constructor(private prisma: PrismaService) {}

  async getProductsFromMonth(monthStr: string) {
    if (!monthStr) {
      throw new BadRequestException('Data não encontrada!');
    }

    const cacheKey = `products_ytd_${monthStr}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.exp > Date.now()) {
      this.logger.debug(
        `Retornando produtos do mês ${monthStr} a partir do CACHE.`,
      );
      return cached.data;
    }

    this.logger.log(`Buscando produtos do mês ${monthStr} no BANCO DE DADOS.`);

    const referenceDate = new Date(`${monthStr}T00:00:00.000Z`);

    if (isNaN(referenceDate.getTime())) {
      throw new BadRequestException(
        'Formato de data inválido. Use YYYY-MM-DD.',
      );
    }

    const whereClause: any = {
      reference_month: referenceDate,
    };

    const monthlyData = await this.prisma.product_monthly_data.findMany({
      where: whereClause,
      include: {
        products: true,
        stores: true,
      },
      orderBy: [{ reference_month: 'asc' }, { description: 'asc' }],
    });

    this.cache.set(cacheKey, {
      data: monthlyData,
      exp: Date.now() + 1000 * 60 * 15,
    });

    return monthlyData;
  }

  async bulkUpdate(products: any[]) {
    this.logger.log(
      `Iniciando atualização em massa (Bulk Update) para ${products?.length || 0} produtos.`,
    );

    if (!products || products.length === 0)
      return { success: true, updatedCount: 0 };

    this.cache.clear();

    return await this.prisma.$transaction(
      async (prisma) => {
        const firstMonthData = products[0]?.monthly_data[0];
        if (firstMonthData && firstMonthData.reference_month) {
          const targetMonth = new Date(firstMonthData.reference_month)
            .toISOString()
            .substring(0, 7);
          const isLocked =
            await prisma.$queryRaw`SELECT * FROM "locked_months" WHERE month = ${targetMonth}`;
          if ((isLocked as any[]).length > 0) {
            throw new BadRequestException(
              'Este mês está bloqueado pelo cadeado e não pode ser alterado.',
            );
          }
        }

        for (const prod of products) {
          let productId = prod.product_id;

          if (String(productId).startsWith('temp_')) {
            const firstMonthData = prod.monthly_data[0];
            if (!firstMonthData) continue;

            let foundId: string | null = null;
            const storeInfo = await prisma.stores.findUnique({
              where: { id: firstMonthData.store_id },
              select: { number: true },
            });
            const isLapa = storeInfo?.number === 3;

            const isValid = (val: any) =>
              val && val !== '-' && val !== 'null' && val !== 'undefined';

            if (isValid(firstMonthData.plucode)) {
              const ex = await prisma.product_monthly_data.findFirst({
                where: {
                  plucode: firstMonthData.plucode,
                  stores: { number: isLapa ? 3 : { not: 3 } },
                },
                select: { product_id: true },
              });
              if (ex) foundId = ex.product_id;
            }

            if (!foundId && isValid(firstMonthData.barcode)) {
              const ex = await prisma.product_monthly_data.findFirst({
                where: { barcode: firstMonthData.barcode },
                select: { product_id: true },
              });
              if (ex) foundId = ex.product_id;
            }

            if (!foundId) {
              const newProduct = await prisma.products.create({ data: {} });
              foundId = newProduct.id;
            }
            productId = foundId;
          }

          const monthlyPromises = prod.monthly_data.map(
            async (monthData: any) => {
              const barcode = String(monthData.barcode || '').trim();
              const plucode = String(monthData.plucode || '').trim();

              const hasBarcode =
                barcode !== '' &&
                barcode !== '-' &&
                barcode !== 'null' &&
                barcode !== 'undefined';
              const hasPlu =
                plucode !== '' &&
                plucode !== '-' &&
                plucode !== 'null' &&
                plucode !== 'undefined';

              if (!hasBarcode && !hasPlu) {
                return;
              }

              const cleanVal = (v: any) => {
                if (v === null || v === undefined) return '';
                const str = String(v).trim();
                const upper = str.toUpperCase();
                return str === '' ||
                  str === '-' ||
                  upper === 'NULL' ||
                  upper === 'UNDEFINED'
                  ? ''
                  : str;
              };

              const hasValidBilling = cleanVal(monthData.billing) !== '';
              const hasValidIcms = cleanVal(monthData.icms) !== '';
              const hasValidAliquot = cleanVal(monthData.icms_aliquot) !== '';
              const hasValidCest = cleanVal(monthData.cest) !== '';
              const hasValidCbenef = cleanVal(monthData.cbenef) !== '';
              const hasValidCclass = cleanVal(monthData.c_class) !== '';
              const hasValidNcm = cleanVal(monthData.ncm) !== '';
              const hasValidPisCofins = cleanVal(monthData.pis_cofins) !== '';

              if (
                !hasValidBilling &&
                !hasValidIcms &&
                !hasValidAliquot &&
                !hasValidCest &&
                !hasValidCbenef &&
                !hasValidCclass &&
                !hasValidNcm &&
                !hasValidPisCofins
              ) {
                return;
              }

              const dataPayload: any = {
                barcode: monthData.barcode,
                obs: monthData.obs,
                is_new:
                  monthData.is_new !== '-' && monthData.is_new !== ''
                    ? monthData.is_new
                    : null,
                correct_icms_office: monthData.correct_icms_office,
                was_st: monthData.was_st,
                made_in_store: monthData.made_in_store,
                monitored: monthData.monitored,
                department: monthData.department,
                section: monthData.section,
                category_group: monthData.category_group,
                plucode: monthData.plucode,
                description: monthData.description,

                icms: monthData.icms,
                icms_aliquot: monthData.icms_aliquot,
                cest: monthData.cest,
                cbenef: monthData.cbenef,
                c_class: monthData.c_class,
                ncm: monthData.ncm,
                pis_cofins: monthData.pis_cofins,
                billing:
                  monthData.billing !== undefined && monthData.billing !== null
                    ? String(monthData.billing)
                    : null,

                ncm_mix_fiscal: monthData.ncm_mix_fiscal,
                cest_mix_fiscal: monthData.cest_mix_fiscal,
                c_class_mix_fiscal: monthData.c_class_mix_fiscal,
                cbenef_mix_fiscal_stores: monthData.cbenef_mix_fiscal_stores,
                cbenef_mix_fiscal_jasps: monthData.cbenef_mix_fiscal_jasps,
                pis_cofins_mix_fiscal: monthData.pis_cofins_mix_fiscal,
                icms_aliquot_mix_fiscal_stores:
                  monthData.icms_aliquot_mix_fiscal_stores,
                icms_aliquot_mix_fiscal_jasps:
                  monthData.icms_aliquot_mix_fiscal_jasps,

                supplier_last_purchase: monthData.supplier_last_purchase,
                supplier_intern_code_last_purchase:
                  monthData.supplier_intern_code_last_purchase,
                note_number_last_purchase: monthData.note_number_last_purchase,
                access_key_last_purchase: monthData.access_key_last_purchase,
                date_last_purchase: monthData.date_last_purchase,
                ncm_last_purchase: monthData.ncm_last_purchase,
                cest_last_purchase: monthData.cest_last_purchase,
                c_class_last_purchase: monthData.c_class_last_purchase,
                cbenef_last_purchase: monthData.cbenef_last_purchase,
                pis_cofins_last_purchase: monthData.pis_cofins_last_purchase,
                icms_aliquot_last_purchase:
                  monthData.icms_aliquot_last_purchase,
              };

              const existingRecord =
                await prisma.product_monthly_data.findFirst({
                  where: {
                    product_id: productId,
                    store_id: monthData.store_id,
                    reference_month: new Date(monthData.reference_month),
                  },
                });

              const lastRecord = await prisma.product_monthly_data.findFirst({
                where: {
                  product_id: productId,
                  store_id: monthData.store_id,
                  reference_month: { lte: new Date(monthData.reference_month) },
                },
                orderBy: { reference_month: 'desc' },
              });

              if (lastRecord) {
                const baseFields = [
                  'obs',
                  'is_new',
                  'correct_icms_office',
                  'was_st',
                  'made_in_store',
                  'monitored',
                  'department',
                  'section',
                  'category_group',
                  'plucode',
                  'barcode',
                  'description',

                  'ncm_mix_fiscal',
                  'cest_mix_fiscal',
                  'c_class_mix_fiscal',
                  'cbenef_mix_fiscal_stores',
                  'cbenef_mix_fiscal_jasps',
                  'pis_cofins_mix_fiscal',
                  'icms_aliquot_mix_fiscal_stores',
                  'icms_aliquot_mix_fiscal_jasps',

                  'supplier_last_purchase',
                  'supplier_intern_code_last_purchase',
                  'note_number_last_purchase',
                  'access_key_last_purchase',
                  'date_last_purchase',
                  'ncm_last_purchase',
                  'cest_last_purchase',
                  'c_class_last_purchase',
                  'cbenef_last_purchase',
                  'pis_cofins_last_purchase',
                  'icms_aliquot_last_purchase',
                ];

                for (const field of baseFields) {
                  const currentValue = dataPayload[field];
                  const isFieldEmpty =
                    currentValue === null ||
                    currentValue === undefined ||
                    currentValue === '';

                  if (isFieldEmpty && !existingRecord) {
                    dataPayload[field] = (lastRecord as any)[field];
                  }
                }
              }

              if (existingRecord) {
                await prisma.product_monthly_data.update({
                  where: { id: existingRecord.id },
                  data: dataPayload,
                });
              } else {
                await prisma.product_monthly_data.create({
                  data: {
                    product_id: productId,
                    store_id: monthData.store_id,
                    reference_month: new Date(monthData.reference_month),
                    ...dataPayload,
                  },
                });
              }
            },
          );

          await Promise.all(monthlyPromises);
        }
        return { success: true, updatedCount: products.length };
      },
      {
        timeout: 60000,
      },
    );
  }

  async getLockedMonths() {
    const locks = await this.prisma.$queryRaw`SELECT * FROM "locked_months"`;
    return (locks as any[]).map((l) => l.month);
  }

  async toggleLockMonth(month: string) {
    this.logger.log(`Alternando bloqueio (Lock) do mês: ${month}`);

    const existing = await this.prisma
      .$queryRaw`SELECT * FROM "locked_months" WHERE month = ${month}`;
    if ((existing as any[]).length > 0) {
      await this.prisma
        .$queryRaw`DELETE FROM "locked_months" WHERE month = ${month}`;
      return { locked: false };
    } else {
      await this.prisma
        .$queryRaw`INSERT INTO "locked_months" (month) VALUES (${month})`;
      return { locked: true };
    }
  }

  async getProductsForProcessor(storeId?: string, group?: string) {
    if (!storeId && !group) {
      throw new BadRequestException('ID da loja ou grupo é obrigatório');
    }

    let isLapa = false;
    let storeNumber = 1;

    if (group) {
      isLapa = group === 'lapa';
      storeNumber = isLapa ? 3 : 1;
    } else if (storeId) {
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        select: { number: true },
      });

      if (!store) {
        throw new BadRequestException('Loja não encontrada');
      }

      isLapa = store.number === 3;

      storeNumber = store.number ?? 1;
    }

    const data = await this.prisma.product_monthly_data.findMany({
      where: {
        stores: {
          number: isLapa ? 3 : { not: 3 },
        },
        plucode: { not: null, notIn: ['', '-'] },
      },
      select: {
        plucode: true,
        barcode: true,
        description: true,
        ncm: true,
        pis_cofins: true,
        icms_aliquot: true,
        cest: true,
        c_class: true,
        cbenef: true,
        department: true,
        section: true,
        category_group: true,
        obs: true,
        is_new: true,
        correct_icms_office: true,
        was_st: true,
        made_in_store: true,
        monitored: true,
        ncm_mix_fiscal: true,
        cest_mix_fiscal: true,
        c_class_mix_fiscal: true,
        cbenef_mix_fiscal_stores: true,
        cbenef_mix_fiscal_jasps: true,
        pis_cofins_mix_fiscal: true,
        icms_aliquot_mix_fiscal_stores: true,
        icms_aliquot_mix_fiscal_jasps: true,
        supplier_last_purchase: true,
        supplier_intern_code_last_purchase: true,
        note_number_last_purchase: true,
        access_key_last_purchase: true,
        date_last_purchase: true,
        ncm_last_purchase: true,
        cest_last_purchase: true,
        c_class_last_purchase: true,
        cbenef_last_purchase: true,
        pis_cofins_last_purchase: true,
        icms_aliquot_last_purchase: true,
        stores: {
          select: { number: true },
        },
      },
      orderBy: { reference_month: 'desc' },
      distinct: ['plucode'],
    });

    return data.map((item) => ({
      ...item,
      stores: { number: storeNumber },
    }));
  }

  async getAvailableMonths() {
    const months = await this.prisma.product_monthly_data.findMany({
      select: { reference_month: true },
      distinct: ['reference_month'],
      orderBy: { reference_month: 'asc' },
    });
    return months.map((m) => m.reference_month.toISOString().split('T')[0]);
  }

  async deleteProduct(id: string) {
    this.logger.warn(`Deletando produto ID: ${id}. Cache será limpo.`);

    this.cache.clear();

    return await this.prisma.products.delete({ where: { id } });
  }
}
