import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CreateDailySalesListDTO,
  UpdateDailySaleDTO,
} from 'src/dtos/daily-sales';
import { PrismaService } from 'src/prisma.service';

@Injectable()
export class DailySalesService {
  private readonly logger = new Logger(DailySalesService.name);

  constructor(private prismaService: PrismaService) {}

  async createDailySales(payload: CreateDailySalesListDTO) {
    this.logger.log(
      `Iniciando importação de ${payload.sales.length} vendas diárias`,
    );

    const cnpjs = [...new Set(payload.sales.map((s) => s.store_cnpj))];
    const stores = await this.prismaService.stores.findMany({
      where: { tax_id: { in: cnpjs } },
    });

    const storeMap = new Map(stores.map((s) => [s.tax_id, s.id]));

    for (const item of payload.sales) {
      const storeId = storeMap.get(item.store_cnpj);

      if (!storeId) {
        this.logger.warn(
          `Loja com CNPJ ${item.store_cnpj} não encontrada na base de dados.`,
        );
        continue;
      }

      let cashRegister = await this.prismaService.cash_registers.findFirst({
        where: {
          store_id: storeId,
          OR: [{ nfce_series: item.series }, { nfe_series: item.series }],
        },
      });

      if (!cashRegister) {
        const isNfeSeries = item.series > 100;
        const baseNumber = isNfeSeries ? item.series - 100 : item.series;

        cashRegister = await this.prismaService.cash_registers.create({
          data: {
            store_id: storeId,
            number: baseNumber,
            nfce_series: baseNumber,
            nfe_series: baseNumber + 100,
            description: `Caixa ${baseNumber}`,
          },
        });
      }

      const parsedDate = new Date(item.report_date);

      const existingSale = await this.prismaService.daily_sales.findFirst({
        where: {
          cash_register_id: cashRegister.id,
          report_date: parsedDate,
        },
      });

      if (existingSale) {
        await this.prismaService.daily_sales.update({
          where: { id: existingSale.id },
          data: {
            total_nfce: item.total_nfce ?? existingSale.total_nfce,
            total_nfe: item.total_nfe ?? existingSale.total_nfe,
            total_summary_map:
              item.total_summary_map ?? existingSale.total_summary_map,
          },
        });
        continue;
      }

      await this.prismaService.daily_sales.create({
        data: {
          cash_register_id: cashRegister.id,
          report_date: parsedDate,
          total_nfce: item.total_nfce || 0,
          total_nfe: item.total_nfe || 0,
          total_summary_map: item.total_summary_map || 0,
        },
      });
    }

    this.logger.log('Importação concluída e caixas sincronizados com sucesso.');
    return { message: 'Importado com sucesso e caixas sincronizados!' };
  }

  async getSales(storeId?: string, startDate?: string, endDate?: string) {
    const where: any = {};

    if (storeId) {
      where.cash_registers = { store_id: storeId };
    }

    if (startDate || endDate) {
      where.report_date = {};
      if (startDate) where.report_date.gte = new Date(startDate);
      if (endDate) where.report_date.lte = new Date(endDate);
    }

    const sales = await this.prismaService.daily_sales.findMany({
      where,
      include: {
        cash_registers: true,
      },
      orderBy: { report_date: 'desc' },
    });

    const registersWhere = storeId ? { store_id: storeId } : {};
    const registers = await this.prismaService.cash_registers.findMany({
      where: registersWhere,
      select: { id: true },
    });
    const registerIds = registers.map((r) => r.id);

    const groupedDates = await this.prismaService.daily_sales.groupBy({
      by: ['cash_register_id'],
      where: {
        cash_register_id: { in: registerIds },
        OR: [
          { total_nfce: { gt: 0 } },
          { total_nfe: { gt: 0 } },
          { total_summary_map: { gt: 0 } },
        ],
      },
      _max: {
        report_date: true,
      },
    });

    const lastOverallDateMap = new Map<string, Date>();
    for (const g of groupedDates) {
      if (g._max.report_date) {
        lastOverallDateMap.set(g.cash_register_id, g._max.report_date);
      }
    }

    const today = new Date();

    const mappedSales = sales.map((sale) => {
      const absoluteLastDate =
        lastOverallDateMap.get(sale.cash_register_id) || sale.report_date;

      const diffTime = Math.abs(
        today.getTime() - new Date(absoluteLastDate).getTime(),
      );
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isOutdated = diffDays > 5;

      return {
        ...sale,
        absolute_last_date: absoluteLastDate,
        is_outdated: isOutdated,
      };
    });

    const lastSale = await this.prismaService.daily_sales.findFirst({
      orderBy: { report_date: 'desc' },
    });

    return {
      data: mappedSales,
      lastUpdate: lastSale?.report_date || null,
    };
  }

  async updateSale(id: string, data: UpdateDailySaleDTO) {
    this.logger.log(`Atualizando venda diária ID: ${id}`);
    const currentSale = await this.prismaService.daily_sales.findUnique({
      where: { id },
    });

    if (!currentSale) {
      throw new NotFoundException('Venda diária não encontrada no sistema.');
    }

    const updatedSale = await this.prismaService.daily_sales.update({
      where: { id },
      data,
    });

    return updatedSale;
  }
}
